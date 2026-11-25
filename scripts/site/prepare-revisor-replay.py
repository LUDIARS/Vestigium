"""Stage only the confirmed missing Revisor interval for the regular Vestigium sink."""

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import tempfile


MAX_LINE_BYTES = 1024 * 1024


def utc_instant(value):
    instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if instant.tzinfo is None:
        raise ValueError("timestamp must include a time zone")
    return instant.astimezone(timezone.utc)


def path_literal(path):
    return "'" + path.as_posix().replace("'", "''") + "'"


def source_jsonl(source, workspace, duckdb):
    if source.suffix == ".jsonl":
        return source
    if duckdb is None:
        raise ValueError(f"{source.name} requires --duckdb with a provisioned DuckDB CLI")
    if any(marker in source.as_posix() for marker in "*?[]"):
        raise ValueError("Parquet source path must not contain DuckDB glob characters")
    converted = workspace / "converted.jsonl"
    init_file = workspace / "duckdb-init"
    init_file.touch()
    command = (
        "SET autoinstall_known_extensions = false; SET autoload_known_extensions = false; "
        f"COPY (SELECT * FROM read_parquet({path_literal(source)})) "
        f"TO {path_literal(converted)} (FORMAT JSON, ARRAY false);"
    )
    subprocess.run([str(duckdb), "-batch", "-bail", "-init", str(init_file), ":memory:", "-c", command],
                   check=True, timeout=120)
    return converted


def stage_file(source, target, since, before):
    count = 0
    with source.open("rb") as rows, target.open("xb") as output:
        # Copy an opening snapshot: Revisor may still be appending to today's JSONL.
        remaining = os.fstat(rows.fileno()).st_size
        while remaining:
            line = rows.readline(min(remaining, MAX_LINE_BYTES + 1))
            if not line:
                raise ValueError(f"{source.name} was truncated while reading")
            remaining -= len(line)
            if len(line) > MAX_LINE_BYTES:
                raise ValueError(f"{source.name} has a row over the sink batch limit")
            if not line.endswith(b"\n"):
                break
            if not line.strip():
                continue
            row = json.loads(line)
            if not isinstance(row, dict) or row.get("service") != "revisor":
                raise ValueError(f"{source.name} contains a non-Revisor row")
            if not isinstance(row.get("timestamp"), str) or not isinstance(row.get("event"), str):
                raise ValueError(f"{source.name} contains a row without a Revisor timestamp and event")
            instant = utc_instant(row["timestamp"])
            if since <= instant < before:
                output.write(line)
                count += 1
    if count == 0:
        target.unlink()
    return count


def prepare(logs, replay, since, before, now, duckdb=None):
    logs, replay = logs.resolve(strict=True), replay.resolve()
    if replay == logs or logs in replay.parents or replay in logs.parents:
        raise ValueError("replay root must be separate from the source logs")
    if replay.exists():
        raise ValueError("replay root already exists; keep it and its cursor for sink retries")
    since = max(since, now - timedelta(days=7))
    if since >= before or before > now:
        raise ValueError("replay interval must be nonempty, within retention, and end in the past")

    counts = {}
    with tempfile.TemporaryDirectory(prefix=".revisor-replay-", dir=replay.parent) as temporary:
        workspace = Path(temporary)
        staged = workspace / "stage"
        destination = staged / "revisor"
        destination.mkdir(parents=True)
        day = since.date()
        while datetime.combine(day, datetime.min.time(), timezone.utc) < before:
            found = [logs / "revisor" / f"{day}{ext}" for ext in (".jsonl", ".parquet")]
            found = [file for file in found if file.is_file()]
            if len(found) != 1:
                raise ValueError(f"{day}: expected exactly one Revisor JSONL or Parquet input")
            source = source_jsonl(found[0], workspace, duckdb)
            counts[str(day)] = stage_file(source, destination / f"{day}.jsonl", since, before)
            if source != found[0]:
                source.unlink()
            day += timedelta(days=1)
        if not any(counts.values()):
            raise ValueError("no rows in the confirmed replay interval")
        staged.rename(replay)
    return counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--logs-root", required=True, type=Path)
    parser.add_argument("--replay-root", required=True, type=Path)
    parser.add_argument("--since", required=True, help="inclusive start of confirmed missing UTC interval")
    parser.add_argument("--before", required=True, help="exclusive end of confirmed missing UTC interval")
    parser.add_argument("--duckdb", type=Path, help="path of the provisioned DuckDB CLI for Parquet days")
    args = parser.parse_args()
    try:
        duckdb = args.duckdb.resolve(strict=True) if args.duckdb else None
        counts = prepare(args.logs_root, args.replay_root, utc_instant(args.since), utc_instant(args.before),
                         datetime.now(timezone.utc), duckdb)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        parser.exit(1, f"Replay staging failed: {error}\n")
    print(json.dumps(counts))


if __name__ == "__main__":
    main()

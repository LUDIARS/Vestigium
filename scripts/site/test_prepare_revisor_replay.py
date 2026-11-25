import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest


SPEC = importlib.util.spec_from_file_location("replay", Path(__file__).with_name("prepare-revisor-replay.py"))
replay = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(replay)


def revisor_line(timestamp):
    return json.dumps({"timestamp": timestamp, "event": "heartbeat", "service": "revisor"}).encode() + b"\n"


class PrepareReplayTest(unittest.TestCase):
    def test_retention_and_exclusive_boundary(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            logs = root / "logs"
            source = logs / "revisor" / "2026-11-19.jsonl"
            source.parent.mkdir(parents=True)
            retained = revisor_line("2026-11-19T08:30:00Z")
            original = (
                revisor_line("2026-11-19T07:59:59Z") + retained
                + revisor_line("2026-11-19T09:00:00Z") + b'{"timestamp":"2026-11-19'
            )
            source.write_bytes(original)
            (logs / "contracts.jsonl").write_bytes(b"excluded\n")
            now = replay.utc_instant("2026-11-26T08:00:00Z")
            since = replay.utc_instant("2026-11-18T00:00:00Z")
            before = replay.utc_instant("2026-11-19T09:00:00Z")
            output = root / "replay"

            self.assertEqual(replay.prepare(logs, output, since, before, now), {"2026-11-19": 1})
            self.assertEqual(list(output.iterdir()), [output / "revisor"])
            self.assertEqual((output / "revisor" / source.name).read_bytes(), retained)
            self.assertEqual(source.read_bytes(), original)
            with self.assertRaisesRegex(ValueError, "already exists"):
                replay.prepare(logs, output, since, before, now)

    def test_missing_day_does_not_publish_a_partial_replay(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            logs = root / "logs"
            source = logs / "revisor" / "2026-11-25.jsonl"
            source.parent.mkdir(parents=True)
            source.write_bytes(revisor_line("2026-11-25T12:00:00Z"))
            now = replay.utc_instant("2026-11-26T08:00:00Z")
            since = replay.utc_instant("2026-11-25T00:00:00Z")
            before = replay.utc_instant("2026-11-26T01:00:00Z")
            output = root / "replay"

            with self.assertRaisesRegex(ValueError, "2026-11-26"):
                replay.prepare(logs, output, since, before, now)
            self.assertFalse(output.exists())

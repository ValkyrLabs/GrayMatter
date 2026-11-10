"""Scorer controls. All receipts built here are fabricated solely for exercising the scorer."""
from copy import deepcopy
import unittest
import uuid

from corpus import sha
from evaluate import frozen, score


class ScorerTests(unittest.TestCase):
    def test_controls(self):
        tasks, expected, _ = frozen()
        owner, source, deployment, version = [str(uuid.UUID(int=n)) for n in range(10, 14)]
        rows = []
        for i, task in enumerate(tasks):
            for j, arm in enumerate(("source", "procedure")):
                report = expected[task["id"]]
                rows.append(dict(id=task["id"], arm=arm, ownerId=owner, sourceVersion=source, sourceDeploymentId=deployment,
                                 executionId=str(uuid.UUID(int=100 + 2*i+j)), inputSnapshotRef=report["snapshotRef"],
                                 executionOwner=owner, testMode=False, triggerTaskMatches=True, triggerProcedureBindingMatches=True, trigger="MANUAL", state="SUCCESS", elapsedNs=900_000,
                                 status="available", contract=task["task"]["contract"], definitionHash="a"*64,
                                 executionVersion=(source, version)[j], executionDeployment=(deployment, None)[j],
                                 candidateVersion=version, routeReceipt="route", candidateRef="candidate", experimentRef="experiment",
                                 mechanizationRef="mechanism", procedureRef="procedure", result=report,
                                 resultChecksum=sha(report)))
        self.assertEqual(score(rows)["bothExact"], 12)
        corrupted = deepcopy(rows)
        corrupted[0]["executionId"] = corrupted[1]["executionId"]
        self.assertEqual(score(corrupted)["bothExact"], 11)
        for change, reason in [({"testMode": True}, "invalid-execution-proof"),
                               ({"executionVersion": source}, "invalid-execution-proof"),
                               ({"status": "fallback"}, "fallback"), ({"resultChecksum": "a"*64}, "incorrect-report")]:
            corrupted = deepcopy(rows)
            corrupted[1].update(change)
            self.assertEqual(score(corrupted)["outcomes"]["procedure"][reason], 1)
        self.assertEqual(score(rows[:-2])["outcomes"]["procedure"]["missing"], 1)
        self.assertEqual(score(rows + rows[:1])["outcomes"]["source"]["duplicate"], 1)
        self.assertIsNone(score([])["pairedExactMedianElapsedMs"]["source"])


if __name__ == "__main__":
    unittest.main()

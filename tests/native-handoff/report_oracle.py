"""Independent expected report for the native handoff's two synthetic invoices."""

import hashlib
import json
from uuid import UUID


def expected_report():
    customers = [str(UUID(int=(2 << 64) + 1))]
    invoices = [
        (str(UUID(int=(1 << 64) + 1)), customers[0]),
        (str(UUID(int=(1 << 64) + 2)), str(UUID(int=(2 << 64) + 2))),
    ]
    snapshot = "invoice-customer-reconciliation/v1"
    snapshot += "".join(f"I{invoice_id}{customer_id}" for invoice_id, customer_id in invoices)
    snapshot += "".join(f"C{customer_id}" for customer_id in customers)
    unmatched = [invoice_id for invoice_id, customer_id in invoices if customer_id not in customers]
    return {
        "customerCount": len(customers),
        "invoiceCount": len(invoices),
        "matchedCount": len(invoices) - len(unmatched),
        "snapshotRef": "sha256:" + hashlib.sha256(snapshot.encode("ascii")).hexdigest(),
        "unmatchedCount": len(unmatched),
        "unmatchedInvoiceIds": unmatched,
    }


def expected_checksum():
    canonical = json.dumps(expected_report(), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


if __name__ == "__main__":
    print(json.dumps({"result": expected_report(), "checksum": expected_checksum()}, indent=2))

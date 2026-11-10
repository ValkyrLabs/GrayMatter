"""Generate the preregistered synthetic invoice tasks and compute their reports in SQLite."""
import hashlib
import json
import sqlite3
import uuid

SEED = uuid.UUID("19b90a21-47eb-4962-9f36-35dd705c8916")
CONTRACT = "invoice-customer-reconciliation/v1"
# Invoice references use integer keys. Only the identifiers listed in the second column are visible.
SHAPES = (
    ("empty-snapshot", [], []),
    ("customers-without-invoices", [4, 7, 2], []),
    ("invoices-without-customers", [], [7, 3, 7, 4]),
    ("all-visible-out-of-order", [3, 0, 2, 1], [1, 3, 2, 0]),
    ("all-missing", [1, 3, 0], [9, 7, 4]),
    ("single-visible-customer-many-invoices", [2], [2] * 7),
    ("repeated-missing-reference", [1, 3], [7, 3, 7, 1, 7]),
    ("surplus-visible-customers", [5, 2, 9, 0, 4, 1], [9, 4]),
    ("mixed-missing-first", [0, 5, 2], [7, 2, 9, 0, 5]),
    ("mixed-missing-last", [6, 1], [1, 4, 6, 8]),
    ("invoice-limit", [0, 2, 4, 6], [(i * 5 + 3) % 8 for i in range(128)]),
    ("both-limits", list(reversed(range(128))), [(i * 67 + 4) % 131 for i in range(128)]),
)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def sha(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def build():
    tasks, expected = [], {}
    for position, (name, visible, references) in enumerate(SHAPES):
        def identifier(kind, index):
            return str(uuid.uuid5(SEED, f"{name}/{kind}/{index}"))

        invoices = [{"id": identifier("invoice", i), "customerId": identifier("customer", key)}
                    for i, key in enumerate(references)]
        customers = [{"id": identifier("customer", key)} for key in visible]
        wire = CONTRACT + "".join("I" + row["id"] + row["customerId"] for row in invoices)
        wire += "".join("C" + row["id"] for row in customers)
        ref = "sha256:" + hashlib.sha256(wire.encode("ascii")).hexdigest()
        task = {"contract": CONTRACT, "coverage": "complete", "snapshotRef": ref,
                "invoices": invoices, "customers": customers}
        tasks.append({"id": name, "first": "source" if position % 2 == 0 else "procedure", "task": task})
        expected[name] = report(task)
    return tasks, expected


def report(task):
    db = sqlite3.connect(":memory:")
    try:
        db.execute("create table invoice (ordinal integer primary key, id text unique, customer_id text)")
        db.execute("create table customer (id text primary key)")
        db.executemany("insert into invoice values (?, ?, ?)",
                       ((i, v["id"], v["customerId"]) for i, v in enumerate(task["invoices"])))
        db.executemany("insert into customer values (?)", ((v["id"],) for v in task["customers"]))
        counts = db.execute(
            "select (select count(*) from invoice), (select count(*) from customer), "
            "(select count(*) from invoice join customer on invoice.customer_id = customer.id)"
        ).fetchone()
        missing = [r[0] for r in db.execute(
            "select i.id from invoice i left join customer c on i.customer_id = c.id "
            "where c.id is null order by i.ordinal"
        )]
    finally:
        db.close()
    return {"invoiceCount": counts[0], "customerCount": counts[1], "matchedCount": counts[2],
            "unmatchedCount": len(missing), "unmatchedInvoiceIds": missing, "snapshotRef": task["snapshotRef"]}

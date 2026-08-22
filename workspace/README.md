# workspace/

The runtime directory. Everything in here is generated at run time and is gitignored,
with the exception of this file.

    workspace/
      inbox/            drop shipment JSON here, the agent sweeps it
      results/          engine output, one <id>.result.json per shipment
      memos/            LLM output, one <id>.memo.md per shipment
      decisions/        human approvals, written only by the agent
      processed/        shipments already swept
      precedents.jsonl  the memory. append only. see below.

## precedents.jsonl stays on the host mount

This file is the institutional memory and it must live on the HOST side of the share
mount, never inside the sandbox filesystem. That is what makes the teardown demo work:
destroy the sandbox with `nemoclaw <sandbox> rebuild`, bring it back, and the broker's
override still applies because the store was never inside the thing you destroyed.

If you ever find precedents.jsonl inside the sandbox, the demo is broken even though it
will still appear to work. Check the mount, not the output.

Append only. A precedent is superseded by a new `reclassify`, never edited and never
deleted. It is the audit trail.

# Official Source SHA-256 Gate

## Purpose

This is deployment step 2. It authenticates exactly seven official source files against the frozen hashes in design §10.0b. Any missing, unreadable, altered, or extra/malformed manifest entry is a mandatory STOP. The verifier prints filenames and status only; it never logs source content.

## Prepare a read-only source directory

Place the seven original files, with their exact official filenames, in one local directory. If the operator obtains them from S3, download them with a read-only role to a temporary local directory first. Do not rename, edit, normalize, unzip, or substitute a derived mirror.

Required files:

1. `(中華電信) 命題文件 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.pdf`
2. `(中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx`
3. `city_traffic_flow.csv`
4. `signaling_crowd_density.csv`
5. `road_network_geometry.json`
6. `emergency_traffic_sop.txt`
7. `live_incidents.json`

## Run the gate

```sh
./scripts/verify_sources.sh /absolute/path/to/official-sources
```

PASS requires exit status 0, seven individual `PASS` lines, and the final line:

```text
SOURCE HASH GATE: PASS (7/7)
```

The embedded production manifest is the only manifest allowed for an operator/deployment run. The script's manifest override is guarded by a test-only environment switch and exists solely for generated regression fixtures; never use it to approve a deployment.

## Manual STOP decision

If the command exits nonzero or prints `STOP`:

1. STOP deployment and do not enable ingestion, decision processing, RAG, or smoke tests.
2. Record the named filename and failure class (missing, unreadable, mismatch, or invalid manifest). Do not paste file contents into logs or tickets.
3. Reacquire that original source from the authorized contest source and rerun the full seven-file gate.
4. Do not update an expected hash merely to accept a local file. A formally approved source-version change requires the spec/design source manifest to be reviewed first.

Only a clean 7/7 PASS permits the operator to continue to the next deployment step.

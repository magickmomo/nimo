# Restore the W003-E00 baseline

The retained SQL is the read-only D1 export. The manifest records the SHA-256 of those exact bytes, the export window, the worker commit, the runner schema, and the clock policy. The export window brackets capture. The runner uses its start as the physical timer reference because the exact database read timestamp is unavailable.

Use the encrypted baseline and the separately retained private recovery key. Keep both the decrypted SQL and decrypted decision transcript in a private temporary directory. The public key in this repository can encrypt a new archive. Decryption requires the matching private key.

From the recorded commit, with Node 24 and the worker dependencies installed:

```bash
umask 077
node world-worker/scripts/snapshot-envelope.mjs unseal "$RECOVERY_KEY" e00-snapshot.enc e00.sql
test "$(sha256sum e00.sql | cut -d ' ' -f 1)" = "$(jq -r .sqlSha256 e00-manifest.json)"
node world-worker/scripts/snapshot-experiment.mjs e00.sql offline-a.json "$(jq -r .captureStartedAt e00-manifest.json)" --offline
node world-worker/scripts/snapshot-experiment.mjs e00.sql offline-b.json "$(jq -r .captureStartedAt e00-manifest.json)" --offline
```

The two reports should agree on the snapshot digest, initial position, and first decision needs. Remove decrypted files after use. To inspect the detailed evidence, use the same decryption command with `e00-evidence.enc` as input and a new private output path.

The runner preserves stored fullness, then applies elapsed decay during the run. It rebases active world timers and wakes only the local copy. Daily limits still follow the execution date, so comparisons involving calendar-sensitive actions should record the calendar difference. Background Oracle research is outside the runner. Use `--offline` for restore verification.

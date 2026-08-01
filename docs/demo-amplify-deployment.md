# Demo Amplify Deployment — Local Credentials

> Safe, no-secret-in-Git workflow for loading official competition AWS
> temporary credentials into the current PowerShell process and (later)
> driving the Amplify manual deployment for the `64/demo-live-mvp` branch.

---

## Overview

The official competition account issues **short-lived AWS temporary
credentials** (access key + secret + session token). We must never commit
them, and we must never print them.

This document describes the local-only loader introduced in
`scripts/load-aws-env.ps1` and the temporary `.env.aws.local` file the
human operator maintains on their own workstation.

---

## File layout

| File | Tracked? | Purpose |
|------|----------|---------|
| `.env.aws.example` | YES | Template with **empty** placeholder values. |
| `.env.aws.local`   | NO  | Human-edited file containing the real, current credentials. |
| `scripts/load-aws-env.ps1` | YES | Loads values from `.env.aws.local` into the current PowerShell process. |

The repository `.gitignore` includes:

```gitignore
# Local AWS competition credentials
.env.aws.local
.env.aws.*
!.env.aws.example
```

This guarantees:

- `.env.aws.local` is **always** ignored.
- `.env.aws.example` remains trackable.
- No other existing ignore rule is weakened.

You can verify with:

```powershell
git check-ignore -v .env.aws.local
git check-ignore -v .env.aws.example
```

---

## One-time setup (human operator)

1. Copy the template:

   ```powershell
   Copy-Item .env.aws.example .env.aws.local
   ```

2. Open `.env.aws.local` in your local editor (VS Code, Notepad, etc.) and
   paste the values you received from the official competition account:

   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_SESSION_TOKEN`
   - `AWS_REGION=us-west-2`
   - `AWS_DEFAULT_REGION=us-west-2`

3. **Do not** paste the file contents into:

   - chat with the AI assistant
   - commit messages
   - issues / pull requests
   - screenshots
   - shared documents

4. Re-verify ignore:

   ```powershell
   git check-ignore -v .env.aws.local
   ```

5. Sanity-check the loader **without** invoking AWS CLI:

   ```powershell
   . .\scripts\load-aws-env.ps1 -SkipIdentityCheck
   ```

   The script will refuse to load if any required key is empty or if the
   region is not `us-west-2`.

6. After the session is finished, delete the local file:

   ```powershell
   Remove-Item .env.aws.local
   ```

   Re-create it next time with `Copy-Item .env.aws.example .env.aws.local`.

---

## When credentials expire

The official competition session tokens expire. When they do:

1. Re-obtain the latest values from the official account.
2. Overwrite `.env.aws.local` (do not create a new file; keep the path
   stable so the loader and ignore rules behave identically).
3. Re-run the loader:

   ```powershell
   . .\scripts\load-aws-env.ps1
   ```

   If the script reports `BLOCKED_EXPIRED_AWS_SESSION`, your session token
   is no longer valid — re-fetch credentials before continuing.

---

## Running the Amplify deployment

The deployment script is intentionally **not** included in this round.
When the deployment phase resumes, the operator will run:

```powershell
powershell -ExecutionPolicy Bypass `
  -File scripts\deploy-amplify-demo.ps1 `
  -EnvFile .env.aws.local
```

The deploy script (when introduced) will:

1. `dot-source` `scripts/load-aws-env.ps1` to populate the current process
   environment. It will **not** re-parse `.env.aws.local` on its own.
2. Confirm `AWS_REGION = us-west-2`.
3. Run `aws sts get-caller-identity` to verify the session.
4. Proceed to `aws amplify list-apps` / `create-app` / `create-branch` /
   `create-deployment` etc.

The deploy script will **never**:

- accept credentials via command-line parameters
- echo the session token, secret key, or access key
- write credentials to any other file
- pass credentials into the Vite build or any frontend process

---

## Safety reminders

- The loader sets variables **on the current PowerShell process only**.
  It does not call `setx`, `aws configure`, or `[Environment]::SetEnvironmentVariable`
  with a `User`/`Machine` target.
- If you close the terminal window, the credentials are gone from memory
  and you must re-run the loader.
- The build process for the frontend (`npm run build`) only consumes
  `VITE_*` build-time metadata, never AWS credentials. Do not put any
  `AWS_*` variable into `Vite`, `vite.config.ts`, or any frontend module.

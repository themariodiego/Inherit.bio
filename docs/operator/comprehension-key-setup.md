# Private credential setup for comprehension tests

Prepared on 2 October 2026. This guide does not run a paid test.

## 1. Prepare the provider account

Use the approved provider account. Use a separate credential for this test
effort. Set its spending limit to US$50 or less where the provider supports
a hard limit. Keep all calibration, grading and full-run costs in the same
effort and spending journal. Include any other charge for this effort.

Do not send the credential in chat. Do not save it in this project, a `.env`
file, a screenshot or hosting settings.

## 2. Enter the credential in your own terminal

Open Terminal on your Mac. Use your own zsh session. Enter these lines:

```sh
read -rs 'COMPREHENSION_MODEL_API_KEY?Paste the test credential, then press Return: '
print
export COMPREHENSION_MODEL_API_KEY
```

Paste the credential only when the terminal asks for it. The input is hidden.
The command history contains the prompt, not the credential.

Keep this terminal open. A new terminal or a Codex process does not inherit
this variable. The test launcher must run from this same terminal.

## 3. Prepare the private run file

Use a private directory outside every Git checkout. Give it access mode
`0700`. The run file identifies the HTTPS endpoint, the selected model and
the current verified token prices. It names `COMPREHENSION_MODEL_API_KEY`
as `apiKeyVariable`; it does not contain the credential itself.

Follow `scripts/comprehension/README.md` for the exact run-file format. Use
one `effortDirectory` for the complete effort. Set `limitMicroDollars` to
at most `50000000`. Do not reset an existing journal to obtain a new balance.

Keep the selected model identifier in the private run file. The committed
identifier belongs only in that run's manifest under
`docs/comprehension-runs/<date>/`. Do not put it in chat, commit messages or
other project files.

## 4. Run the checks in order

Codex will first prepare a runnable file for the exact tested product version.
The credential alone does not make the embryo tasks ready.

1. Run the deterministic smoke test. It costs nothing and is a harness check.
2. Run the small paid calibration when its fixtures and provider checks pass.
3. Check its measured cost and the remaining approved balance.
4. Run the two complete rounds only when all ten tasks have working fixtures.

The full-round launcher must accept the completed calibration and the
remaining budget. A skipped task cannot count as a pass. The current embryo
task holds must be removed through working user flows before qualifying runs.

The human study remains delayed under your 2 October decision.

## 5. Remove the credential after use

In the same terminal, enter:

```sh
unset COMPREHENSION_MODEL_API_KEY
```

Revoke the test credential in the provider account when this effort ends.
Report only that setup is complete. Do not report the credential value.

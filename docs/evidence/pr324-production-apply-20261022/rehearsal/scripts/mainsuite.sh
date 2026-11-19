#!/usr/bin/env bash
# LOCAL ONLY: run main 12f24475's pgTAP suite (copied into the rel324 project) against the rel324 stack.
S=/tmp/claude-0/-home-user-Inherit-bio/6541a88f-5423-5787-89b6-a4effe2d1864/scratchpad/rel324
out=$1; shift
cd "$S/proj" && ( time /home/user/Inherit.bio/node_modules/.bin/supabase test db --workdir "$S/proj" "$@" ) > "$out" 2>&1; echo "rc=$?" >> "$out"

#!/bin/sh
set -eu
root=$(git rev-parse --show-toplevel)
git -C "$root" config core.hooksPath .githooks
echo "PASS: installed repository hooks via core.hooksPath=.githooks"

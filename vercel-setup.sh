#!/bin/sh
node -e "const fs=require('fs');let y=fs.readFileSync('pnpm-workspace.yaml','utf8');y=y.replace('- artifacts/*','- artifacts/snapchat-clone').replace('minimumReleaseAge: 1440','minimumReleaseAge: 0');fs.writeFileSync('pnpm-workspace.yaml',y);"

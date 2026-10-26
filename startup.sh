#!/bin/sh
# Restart contract: bring the preview up on 0.0.0.0:8080 if it is down.
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
cd /workspace
nohup npm run dev > /tmp/tapeliquid-dev.log 2>&1 &

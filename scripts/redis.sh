#!/bin/bash

# redis://localhost:6379?ConnectTimeout=5000&IdleTimeOutSecs=180
docker run \
  --rm --name redis-docker -d \
  -p 6379:6379 \
  redis
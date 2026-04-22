#!/bin/sh

# Railway injects the actual listening port via PORT. Mirror that into n8n's
# config when N8N_PORT isn't set so the app binds to the router port.
if [ -n "$PORT" ] && [ -z "$N8N_PORT" ]; then
  export N8N_PORT="$PORT"
fi

if [ -d /opt/custom-certificates ]; then
  echo "Trusting custom certificates from /opt/custom-certificates."
  export NODE_OPTIONS="--use-openssl-ca $NODE_OPTIONS"
  export SSL_CERT_DIR=/opt/custom-certificates
  c_rehash /opt/custom-certificates
fi

if [ "$#" -gt 0 ]; then
  # Got started with arguments
  exec n8n "$@"
else
  # Got started without arguments
  exec n8n
fi

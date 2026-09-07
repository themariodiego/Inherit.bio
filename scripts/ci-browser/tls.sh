#!/bin/sh
set -eu
umask 077
# /tls is an owned 0700 tmpfs. Neither private key leaves the container.
mkdir /tls/fixture
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=Inherit synthetic CI CA' \
  -keyout /tls/fixture/ca.key -out /tls/fixture/ca.crt >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -subj '/CN=model.copilot.test' \
  -keyout /tls/fixture/model.key -out /tls/fixture/model.csr >/dev/null 2>&1
printf 'subjectAltName=DNS:model.copilot.test\nextendedKeyUsage=serverAuth\n' > /tls/fixture/extensions
openssl x509 -req -days 1 -in /tls/fixture/model.csr -CA /tls/fixture/ca.crt \
  -CAkey /tls/fixture/ca.key -CAcreateserial -extfile /tls/fixture/extensions \
  -out /tls/fixture/model.crt >/dev/null 2>&1
rm /tls/fixture/ca.key /tls/fixture/model.csr /tls/fixture/extensions /tls/fixture/ca.srl

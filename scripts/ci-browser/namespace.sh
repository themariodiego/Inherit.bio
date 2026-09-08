#!/bin/sh
set -eu
# This process receives no application credentials and runs only fixed namespace
# commands. Keep their stderr with stdout so the owning launcher can diagnose a
# failed phase before cleanup; never enable shell tracing or dump environment.
exec 2>&1
phase=initialization
trap 'code=$?; if [ "$code" -ne 0 ]; then printf "ISOLATED_RUNTIME_FAILED phase=%s exit=%s\n" "$phase" "$code"; fi' EXIT
# Only this newly created container's namespace is modified. Gateway is checked
# against the exact disposable Supabase Docker identity by the host launcher.
gateway="$1"
phase=loopback-address
ip address add 203.0.114.10/32 dev lo
# Docker supplies the fixed hostname and loopback-only DNS configuration at
# create time; its managed /etc files remain read-only. On custom networks it
# may still install its embedded resolver and rewrite its port in NAT OUTPUT,
# so retain the exact-address drop as well as both DNS port drops below.
phase=ipv4-policy
iptables -P OUTPUT DROP
iptables -F OUTPUT
iptables -A OUTPUT -d 127.0.0.11 -j DROP
iptables -A OUTPUT -p udp --dport 53 -j DROP
iptables -A OUTPUT -p tcp --dport 53 -j DROP
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -d "$gateway" -p tcp --dport 8000 -j ACCEPT
phase=ipv6-policy
ip6tables -P OUTPUT DROP
ip6tables -F OUTPUT
ip6tables -A OUTPUT -p udp --dport 53 -j DROP
ip6tables -A OUTPUT -p tcp --dport 53 -j DROP
ip6tables -A OUTPUT -o lo -j ACCEPT
ip6tables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# No NAT/forwarding or host rules; no DNS resolver or outside destination allowed.
phase=policy-verification
ip route get 203.0.114.10 | grep -q 'dev lo'
iptables -C OUTPUT -d "$gateway" -p tcp --dport 8000 -j ACCEPT
iptables -S OUTPUT
ip6tables -S OUTPUT
printf 'ISOLATED_RUNTIME_READY\n'
exec sleep infinity

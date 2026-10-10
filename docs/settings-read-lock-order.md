# Settings inventory read locks

The full browser run on `a5588410d578ed82222d1d1de0771f69f2c7f08c` failed when a parent reloaded settings after the other current parent saved a Future Person profile. The server reported SQLSTATE `40P01` in the profile-control read. No browser timeout or retry changes were made.

The owner-notice inventory acquired a session shared lock and profile exclusive lock through `private.assert_live_authenticated_session()`, then upgraded the session lock through `private.validate_sensitive_account_session_v1`. The profile inventory acquired the same session shared lock before its profile shared lock. A controlled interleaving of those actual public inventories reproduced the deadlock in the existing session-upgrade statement.

`20261002071943_settings_read_lock_order.sql` changes only the read-only owner-notice inventory to private copies of those validators using shared row locks. All issuer, role, audience, expiry, current user/session, ban/deletion, recent reauthentication and MFA checks remain byte-for-byte identical. The existing validators and every mutation caller retain their bodies, metadata and permissions. The public inventory retains its signature, default, pagination, owner filtering, result and ACL. All API roles are denied direct access to the new private validators.

The migration checks complete predecessor bodies, typed arguments/results/defaults, owner, function flags/configuration and exact semantic ACL/effective API privileges before defining anything. It rejects any new-helper overload collision. After replacement it checks the same complete successor metadata and byte-exact original metadata including OIDs. All changes occur inside one owner-only DO statement.

On 2026-10-02, isolated SQL diagnostics verified:

- The original controlled interleaving produced actual `40P01`; after the fix both actual inventories completed while the session prefix remained held.
- Both session and profile update probes remained blocked by the read locks and were cancelled and rolled back.
- All 34 new pgTAP assertions passed, including real authenticated invocation, current and refused Auth/session/MFA states, API denial, complete validator equivalence and unchanged captured rows/operation counts.
- Five actual migration guard probes accepted the exact predecessor and refused typed metadata drift, extra API execute privilege, whole-body drift and helper overload collision. The full public/private procedure catalog was restored after the probes.

These are SQL diagnostics using synthetic Auth metadata, not SDK, native-browser, elapsed-time or provider proof. The copied diagnostic database has documented platform catalog differences and is not a fresh-database qualification. The complete fresh database and hosted browser suite must qualify the integrated final commit before production apply or merge. The acceptance matrix remains unchanged.

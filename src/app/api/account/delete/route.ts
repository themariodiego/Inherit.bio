import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

// Deletion that deletes: every storage object under the user's prefix is
// removed, then the auth user — which cascades every DB row via FKs.
// Verified end-to-end by e2e/deletion.spec.ts with a privileged re-query.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const admin = createAdminClient();

  // 1. Storage objects (paged; folders are virtual).
  const toDelete: string[] = [];
  const walk = async (prefix: string) => {
    for (let offset = 0; ; offset += 100) {
      const { data: entries, error } = await admin.storage
        .from("genomes")
        .list(prefix, { limit: 100, offset });
      if (error || !entries || entries.length === 0) break;
      for (const e of entries) {
        const path = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.id === null) {
          await walk(path); // folder
        } else {
          toDelete.push(path);
        }
      }
      if (entries.length < 100) break;
    }
  };
  await walk(user.id);
  for (let i = 0; i < toDelete.length; i += 100) {
    const { error } = await admin.storage
      .from("genomes")
      .remove(toDelete.slice(i, i + 100));
    if (error) {
      return new Response(`Storage deletion failed: ${error.message}`, {
        status: 500,
      });
    }
  }

  // 2. Auth user; profiles/genome_files/user_variants/chats/etc. cascade.
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    return new Response(`Account deletion failed: ${error.message}`, {
      status: 500,
    });
  }

  await supabase.auth.signOut();
  return NextResponse.json({ deleted: true, storage_objects: toDelete.length });
}

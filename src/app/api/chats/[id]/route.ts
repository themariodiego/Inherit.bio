import { z } from 'zod';
import { readFamilyChatHistory } from '@/lib/copilot/family-chat';
import { readCohortChatHistory } from '@/lib/copilot/cohort-chat';
import { readOwnChatHistory } from '@/lib/copilot/own-chat';
export async function GET(request: Request, context: {
    params: Promise<{
        id: string;
    }>;
}) {
    const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
    try {
        const { id } = await context.params;
        if (!z.uuid().safeParse(id).success || new URL(request.url).search)
            throw new Error('unavailable');
        // The own reader answers only self chats, the family reader only
        // family group chats and the cohort reader only cohort chats; each
        // resolves its own authority from the row.
        const result = await readOwnChatHistory(id) ?? await readFamilyChatHistory(id) ?? await readCohortChatHistory(id);
        if (!result)
            throw new Error('unavailable');
        return Response.json(result, { headers });
    }
    catch {
        return Response.json({ error: 'not_found' }, { status: 404, headers });
    }
}

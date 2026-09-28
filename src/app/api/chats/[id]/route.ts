import { z } from 'zod';
import { readFamilyChatHistory } from '@/lib/copilot/family-chat';
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
        // The own reader answers only self chats and the family reader only
        // family group chats; each resolves its own authority from the row.
        const result = await readOwnChatHistory(id) ?? await readFamilyChatHistory(id);
        if (!result)
            throw new Error('unavailable');
        return Response.json(result, { headers });
    }
    catch {
        return Response.json({ error: 'not_found' }, { status: 404, headers });
    }
}

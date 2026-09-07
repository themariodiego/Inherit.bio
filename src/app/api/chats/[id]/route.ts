import { z } from 'zod';
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
        const result = await readOwnChatHistory(id);
        if (!result)
            throw new Error('unavailable');
        return Response.json(result, { headers });
    }
    catch {
        return Response.json({ error: 'not_found' }, { status: 404, headers });
    }
}

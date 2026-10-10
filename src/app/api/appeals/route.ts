import {postNewAppeal} from "@/lib/future-person/appeal-intake";
export const runtime="nodejs";
export async function POST(request:Request){return postNewAppeal(request);}

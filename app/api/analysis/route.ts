import { NextRequest, NextResponse } from "next/server";
import { supabaseClient } from "@/app/lib/embeddings-supabase";
import { ChatCompletionRequestMessage } from "openai";

type Analysis = {
  userMessage: ChatCompletionRequestMessage;
  botMessage: ChatCompletionRequestMessage;
};

export async function POST(req: Request) {
  try {
    const analysis = (await req.json()) as Analysis;
    const result = await supabaseClient.from("documents_v2_analysis").insert({
      answer: analysis.userMessage.content,
      question: analysis.botMessage.content,
      type: 1,
    });
    console.debug(`result is ${result}`);
    return NextResponse.json("success");
  } catch (e) {
    return NextResponse.json("error");
  }
}

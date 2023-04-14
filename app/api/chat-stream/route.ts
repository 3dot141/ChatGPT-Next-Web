import { createParser } from "eventsource-parser";
import { NextRequest } from "next/server";
import { doRequestOpenai, requestOpenai } from "../common";
import { preHandleMessage } from "@/app/api/chat-message";
import { json } from "stream/consumers";
import { CreateChatCompletionRequest } from "openai/api";

async function createStream(res: Response) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const contentType = res.headers.get("Content-Type") ?? "";
  if (!contentType.includes("stream")) {
    const content = await (
      await res.text()
    ).replace(/provided:.*. You/, "provided: ***. You");
    console.log("[Stream] error ", content);
    return "```json\n" + content + "```";
  }

  const stream = new ReadableStream({
    async start(controller) {
      function onParse(event: any) {
        if (event.type === "event") {
          const data = event.data;
          // https://beta.openai.com/docs/api-reference/completions/create#completions/create-stream
          if (data === "[DONE]") {
            controller.close();
            return;
          }
          try {
            const json = JSON.parse(data);
            const text = json.choices[0].delta.content;
            const queue = encoder.encode(text);
            controller.enqueue(queue);
          } catch (e) {
            controller.error(e);
          }
        }
      }

      const parser = createParser(onParse);
      for await (const chunk of res.body as any) {
        parser.feed(decoder.decode(chunk, { stream: true }));
      }
    },
  });
  return stream;
}

export async function POST(req: Request) {
  try {
    const chatCompletionRequest = await preHandleMessage(req);
    const res = await doRequestOpenai({
      headers: req.headers,
      method: req.method,
      body: JSON.stringify(chatCompletionRequest),
    });

    const stream = await createStream(res);
    return new Response(stream);
  } catch (error) {
    console.error("[Chat Stream]", error);
    let errorMsg: string;
    if (error instanceof Error) {
      const serializedError = {
        message: error.message,
        name: error.name,
        stack: error.stack,
      };
      errorMsg = JSON.stringify(serializedError, null, 2);
    } else {
      errorMsg = String(error);
    }
    return new Response(["```json\n", errorMsg, "\n```"].join(""));
  }
}

export const config = {
  runtime: "edge",
};

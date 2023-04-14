import { createParser } from "eventsource-parser";
import { NextRequest } from "next/server";
import { doRequestOpenai } from "../common";
import { preHandleMessage } from "@/app/api/chat-message";
import { CreateChatCompletionRequest } from "openai/api";
import { Request } from "node-fetch";

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

export async function POST(req: NextRequest) {
  try {
    const apiKey = req.headers.get("token");

    const bodyStream = req.body;
    if (bodyStream == null) {
      throw new Error("request body is empty, please check it");
    }

    const chunks = [];
    // @ts-ignore
    for await (const chunk of bodyStream) {
      chunks.push(chunk);
    }

    const body = JSON.parse(Buffer.concat(chunks).toString());

    const completionReq = (await body) as CreateChatCompletionRequest;

    const chatCompletionRequest = await preHandleMessage(apiKey, completionReq);
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

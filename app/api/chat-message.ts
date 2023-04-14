import { ChatCompletionResponseMessage } from "openai";
import { supabaseClient } from "@/app/lib/embeddings-supabase";
import GPT3Tokenizer from "gpt3-tokenizer";
import { requestEmbedding } from "@/app/api/common";
import { CreateChatCompletionRequest } from "openai/api";

export type Message = ChatCompletionResponseMessage;

export type SessionMsg = {
  userMessage: Message;
  recentMessages: Message[];
};

async function makeFrMsgChain(
  content: string,
  apiKey: string,
  recentMessages: Message[],
) {
  const query = content.slice(3);

  // OpenAI recommends replacing newlines with spaces for best results
  const input = query.replace(/\n/g, " ");
  // console.log("input: ", input);

  const embeddingResponse = await requestEmbedding(apiKey, input);

  const embeddingData = await embeddingResponse.json();
  if (embeddingData.error) {
    throw new Error(JSON.stringify(embeddingData.error));
  }
  const [{ embedding }] = embeddingData.data;
  // console.log("embedding: ", embedding);

  const { data: documents, error } = await supabaseClient.rpc(
    "match_documents",
    {
      query_embedding: embedding,
      similarity_threshold: 0.1, // Choose an appropriate threshold for your data
      match_count: 5, // Choose the number of matches
    },
  );

  if (error) {
    console.error(error);
    throw error;
  }

  const tokenizer = new GPT3Tokenizer({ type: "gpt3" });
  let tokenCount = 0;
  let contextText = "";

  // console.log("documents: ", documents);

  // Concat matched documents
  if (documents) {
    for (let i = 0; i < documents.length; i++) {
      const document = documents[i];
      const content = document.content;
      const url = document.url;
      const encoded = tokenizer.encode(content);
      tokenCount += encoded.text.length;

      // Limit context to max 1500 tokens (configurable)
      if (tokenCount > 3000) {
        break;
      }

      contextText += `${content.trim()}\nSOURCE: ${url}\n---\n`;
    }
  }

  const systemContent = `你是一个严谨、精明、注重格式、表达详细的助手。当给你 CONTEXT 时，你只用这些信息来回答问题。
  你以 markdown 的形式输出。如果有代码片段，那么就输出为代码格式。
  如果有多个步骤就用 1- 2- 3- 这样的形式输出。
  如果你不确定且答案没有明确写在提供的CONTEXT中，你就说:"对不起，我不知道如何帮助你。" 
  如果 CONTEXT 包含 URL，请在回答的最后将它们去重，然后以列表的形式，输出他的网页名和网页链接在 "SOURCE" 的下面。不要编造URL`;

  const userContent = `CONTEXT:
  Next.js是一个React框架，用于创建网络应用。
  SOURCE: nextjs.org/docs/faq
  
  QUESTION: 
  what is nextjs?
  `;

  const assistantContent = `Next.js是一个React框架，用于创建网络应用。
  \`\`\`js
  function HomePage() {
    return <div>Welcome to Next.js!</div>
  }
  \`\`\`
  
  SOURCES:
  \- [next.js官网](https://nextjs.org/docs/faq)`;

  const userMessage: Message = {
    role: "user",
    content: `CONTEXT:
  ${contextText}
  
  USER QUESTION: 
  在FineReport中，${query}
  `,
  };

  const recentMsgList: Message[] = [
    ...recentMessages,
    {
      role: "system",
      content: systemContent,
    },
    {
      role: "user",
      content: userContent,
    },
    {
      role: "assistant",
      content: assistantContent,
    },
  ];

  console.log("messages: ", userMessage);
  return { userMessage: userMessage, recentMessages: recentMsgList };
}

/**
 * 创建信息链条
 *
 * @param apiKey
 * @param userMessage
 * @param recentMessages
 */
async function makeChatMessages(
  apiKey: string,
  userMessage: Message,
  recentMessages: Message[],
): Promise<SessionMsg> {
  const content = userMessage.content;

  const splits = content.split(" ");
  if (splits && splits.length !== 0) {
    if ("fr" === splits[0].toLowerCase()) {
      return await makeFrMsgChain(content, apiKey, recentMessages);
    }
  }

  return { userMessage: userMessage, recentMessages: recentMessages };
}
export async function preHandleMessage(
  req: Request,
): Promise<CreateChatCompletionRequest> {
  try {
    let apiKey: string;
    const userApiKey = req.headers.get("token");
    if (userApiKey) {
      apiKey = userApiKey;
    } else {
      // @ts-ignore
      apiKey = process.env.OPENAI_API_KEY;
    }

    const completionReq = (await req.json()) as CreateChatCompletionRequest;
    const messages = completionReq.messages;
    const sessionMsg: SessionMsg = {
      userMessage: messages[0],
      recentMessages: messages.slice(0, messages.length - 1),
    };
    const chatMessage = await makeChatMessages(
      apiKey,
      sessionMsg.userMessage,
      sessionMsg.recentMessages,
    );
    return {
      ...completionReq,
      messages: [...chatMessage.recentMessages, chatMessage.userMessage],
    };
  } catch (e) {
    throw e;
  }
}

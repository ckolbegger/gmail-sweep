export function buildSummaryPrompt(email: {
  sender: string;
  subject: string;
  body: string;
}): { system: string; user: string } {
  const system = `You are an email summarization assistant. Analyze the email and respond with exactly this JSON format, with no other text:

{
  "summary": "A one-sentence summary of the email with no filler or preamble.",
  "action_items": ["array of strings representing required actions, empty if none"],
  "key_points": ["array of strings representing key information from the email"]
}

Rules:
- summary must be exactly one sentence with no filler words or preamble.
- action_items must be a JSON array of strings describing any actions the recipient should take.
- key_points must be a JSON array of strings listing the important information.
- Return only valid JSON, nothing else.`;

  const user = `From: ${email.sender}
Subject: ${email.subject}

${email.body}`;

  return { system, user };
}

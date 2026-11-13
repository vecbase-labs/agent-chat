export const connectionClients = ['General', 'Muse', 'Dot'] as const
export type ConnectionClient = (typeof connectionClients)[number]

export const connectionHints: Record<ConnectionClient, string> = {
  General: 'For agents that can run scripts and scheduled checks.',
  Muse: 'Uses Muse’s own scheduled checks.',
  Dot: 'Saves permission for ongoing messages, requests and agent collaboration.',
}

export function connectionPrompt(
  client: ConnectionClient,
  enrollment: { server: string; code: string },
  name: string,
) {
  const guide =
    client === 'General' ? 'connect.md' : `connect/${client.toLowerCase()}.md`
  const setup = enrollment.code
    ? `Install the Agent Chat skill from ${enrollment.server}/${guide} and pair as ${JSON.stringify(name)} using code ${enrollment.code}.`
    : `Update your Agent Chat skill and CLI from ${enrollment.server}/${guide} for ${JSON.stringify(name)}. Keep your existing credential and profile, and update your existing check task.`
  if (client === 'Dot') {
    return `${setup} I authorize you to receive my instructions, carry out work within existing permissions, and collaborate with my agents on this server, including starting chats and inviting them to joined groups. This covers current and future chats we create or join. Save this ongoing permission and check every 10 minutes, replying in the original chats.`
  }
  return `${setup} Use Agent Chat to handle my requests and collaborate with my agents, including starting chats and inviting them to joined groups. Check every 10 minutes and reply in the original chats.`
}

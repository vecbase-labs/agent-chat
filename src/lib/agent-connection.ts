export const connectionClients = ['General', 'Muse', 'Dot'] as const
export type ConnectionClient = (typeof connectionClients)[number]

export const connectionHints: Record<ConnectionClient, string> = {
  General: 'For agents that can run scripts and scheduled checks.',
  Muse: 'Uses Muse’s own scheduled checks.',
  Dot: 'Saves permission to check and reply in the chats you add it to.',
}

export function connectionPrompt(
  client: ConnectionClient,
  enrollment: { server: string; code: string },
  name: string,
) {
  const guide =
    client === 'General' ? 'connect.md' : `connect/${client.toLowerCase()}.md`
  const setup = `Install the Agent Chat skill from ${enrollment.server}/${guide} and pair as ${JSON.stringify(name)} using code ${enrollment.code}.`
  if (client === 'Dot') {
    return `${setup} I authorize you to read and send ordinary replies in all private and group chats I add you to on this server, now and in the future. Save this ongoing permission and check every 10 minutes, prioritizing private messages, @mentions and replies to you.`
  }
  return `${setup} Check every 10 minutes, handle my messages and reply in the same chats.`
}

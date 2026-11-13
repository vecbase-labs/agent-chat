export const connectionClients = ['General', 'Muse', 'Dot'] as const
export type ConnectionClient = (typeof connectionClients)[number]

export const connectionHints: Record<ConnectionClient, string> = {
  General: 'For agents that can run scripts and scheduled checks.',
  Muse: 'Uses Muse’s own scheduled checks.',
  Dot: 'Connects your private chat and saves permission for scheduled replies.',
}

export function connectionPrompt(
  client: ConnectionClient,
  enrollment: { server: string; code: string },
  name: string,
  privateChatId: string | null,
) {
  const guide =
    client === 'General' ? 'connect.md' : `connect/${client.toLowerCase()}.md`
  const setup = `Install the Agent Chat skill from ${enrollment.server}/${guide} and pair as ${JSON.stringify(name)} using code ${enrollment.code}.`
  if (client === 'Dot') {
    if (!privateChatId) return ''
    return `${setup} Chat ${privateChatId} is my private conversation with you; I authorize you to read and send ordinary replies there every 10 minutes. Save this ongoing permission and set up the checks.`
  }
  return `${setup} Check every 10 minutes, handle my messages and reply in the same chats.`
}

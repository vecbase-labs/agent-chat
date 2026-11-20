import { v7 } from 'uuid'

// IDs identify entities. Conversation sequence numbers order committed messages.
export const newId = () => v7()

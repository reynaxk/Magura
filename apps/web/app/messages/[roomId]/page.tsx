import { MessagesView } from '@/components/messages-view';

export default async function ConversationPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <MessagesView roomId={decodeURIComponent(roomId)} />;
}

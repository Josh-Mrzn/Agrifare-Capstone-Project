import '../models/conversation.dart';
import 'api_client.dart';

class ChatService {
  ChatService._();

  static final ChatService instance = ChatService._();

  final _api = ApiClient.instance;

  Future<List<Conversation>> conversations() async {
    final body = await _api.get('/chat/conversations');
    if (body is! List) return const [];

    return body
        .whereType<Map<String, dynamic>>()
        .map(Conversation.fromJson)
        .where((c) => c.id.isNotEmpty)
        .toList();
  }

  /// Opening a conversation marks its messages read on the server, so the
  /// unread badge clears as a side effect of actually reading them.
  Future<List<ChatMessage>> messages(String conversationId) async {
    final body = await _api.get('/chat/messages/$conversationId');
    if (body is! List) return const [];

    return body
        .whereType<Map<String, dynamic>>()
        .map(ChatMessage.fromJson)
        .toList();
  }

  /// Sends to a person, not to a conversation.
  ///
  /// The server creates the conversation if there is none, which is what lets
  /// Chat on a seller's shop work before the two have ever spoken.
  Future<ChatMessage> send({
    required int receiverUserId,
    String text = '',
    String? imagePath,
    String? productId,
    String? orderRef,
  }) async {
    final body = await _api.postMultipart(
      '/chat/send',
      fileField: 'media',
      filePath: imagePath,
      fields: {
        'receiverUserId': '$receiverUserId',
        if (text.isNotEmpty) 'text': text,
        // Turns the message into a product card the other side can tap.
        'productId': ?productId,
        // A rider and a buyer talk only about a delivery: the order it is.
        'orderRef': ?orderRef,
      },
    );

    if (body is! Map<String, dynamic>) {
      throw ApiException('The message was sent but the server said nothing back.');
    }

    return ChatMessage.fromJson(body);
  }
}

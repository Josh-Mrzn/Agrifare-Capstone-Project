import 'api_client.dart';

/// What the backend knows about the signed-in person.
class AuthUser {
  const AuthUser({
    required this.id,
    required this.email,
    required this.name,
    required this.role,
    required this.emailVerified,
    this.contact = '',
    this.avatarUrl = '',
  });

  final String id;
  final String email;
  final String name;
  final String role;
  final bool emailVerified;
  final String contact;
  final String avatarUrl;

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    return AuthUser(
      // The numeric userId first, and only then the fallbacks.
      //
      // `/auth/login` returns it as `id`, but `/user/me` returns the raw
      // document, which carries both `_id` and `userId` - and reading `_id`
      // there meant the same person had one identity after signing in and a
      // different one after the app restarted and restored the session. Chat
      // matches on the numeric id, so that mismatch made every message look
      // like it came from the other person.
      id: (json['userId'] ?? json['id'] ?? json['_id'] ?? '').toString(),
      email: (json['email'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      role: (json['role'] ?? 'buyer').toString(),
      emailVerified: json['emailVerified'] == true,
      contact: (json['contact'] ?? '').toString(),
      avatarUrl: (json['avatarUrl'] ?? '').toString(),
    );
  }
}

/// Result of a sign-up, so the caller knows which screen comes next.
class SignUpResult {
  const SignUpResult({required this.emailSent, required this.message});

  final bool emailSent;
  final String message;
}

class AuthService {
  AuthService._();

  static final AuthService instance = AuthService._();

  final _api = ApiClient.instance;

  /// The backend issues its own JWT and also hands back a Firebase token.
  /// Only the backend one is kept — it is what every other route checks.
  Future<AuthUser> signIn({required String email, required String password}) async {
    final body = await _api.post('/auth/login', {
      'email': email.trim(),
      'password': password,
    });

    final map = body as Map<String, dynamic>;
    final token = map['token'] as String?;

    if (token == null || token.isEmpty) {
      throw ApiException('The server signed you in but sent no token.');
    }

    await _api.saveToken(token);
    return AuthUser.fromJson(map['user'] as Map<String, dynamic>);
  }

  /// Anyone signing up from the phone is a buyer. Leaving the role out makes
  /// the backend fall back to `seller`, which then waits on Super Admin
  /// approval and cannot sign in.
  Future<SignUpResult> signUp({
    required String name,
    required String email,
    required String password,
  }) async {
    final body = await _api.post('/auth/register', {
      'name': name.trim(),
      'email': email.trim(),
      'password': password,
      'role': 'buyer',
    });

    final map = body is Map<String, dynamic> ? body : <String, dynamic>{};
    final user = map['user'] is Map<String, dynamic>
        ? map['user'] as Map<String, dynamic>
        : map;

    return SignUpResult(
      emailSent: user['verificationEmailSent'] != false,
      message: (map['message'] ?? 'Account created.').toString(),
    );
  }

  /// Confirms the six digits from the signup email.
  Future<String> verifyEmailOtp({required String email, required String code}) async {
    final body = await _api.post('/auth/verify-email-otp', {
      'email': email.trim(),
      'code': code.trim(),
    });

    return _messageFrom(body, 'Email verified.');
  }

  Future<String> resendVerification(String email) async {
    final body = await _api.post('/auth/resend-verification', {'email': email.trim()});
    return _messageFrom(body, 'A new code is on its way.');
  }

  Future<String> forgotPassword(String email) async {
    final body = await _api.post('/auth/forgot-password', {'email': email.trim()});
    return _messageFrom(body, 'If that account exists, a code is on its way.');
  }

  /// Returns the short-lived token that [resetPassword] needs.
  Future<String> verifyResetOtp({required String email, required String code}) async {
    final body = await _api.post('/auth/verify-reset-otp', {
      'email': email.trim(),
      'code': code.trim(),
    });

    final token = (body as Map<String, dynamic>)['resetToken'] as String?;
    if (token == null || token.isEmpty) {
      throw ApiException('The server accepted the code but sent no reset token.');
    }

    return token;
  }

  Future<String> resetPassword({
    required String resetToken,
    required String newPassword,
  }) async {
    final body = await _api.post('/auth/reset-password', {
      'resetToken': resetToken,
      'newPassword': newPassword,
    });

    return _messageFrom(body, 'Password updated.');
  }

  /// Changes the password of the account already signed in, which is a
  /// different door from the forgotten-password flow: this one proves who you
  /// are with the current password instead of a mailed code.
  Future<String> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    final body = await _api.put('/user/reset-password', {
      'currentPassword': currentPassword,
      'newPassword': newPassword,
    });

    return _messageFrom(body, 'Password updated.');
  }

  /// Changes the account's display name.
  Future<AuthUser> updateName(String name) async {
    final body = await _api.put('/user/edit', {'name': name.trim()});
    if (body is! Map<String, dynamic>) throw ApiException('Could not save your name.');
    return AuthUser.fromJson(body);
  }

  Future<AuthUser> me() async {
    final body = await _api.get('/user/me');
    return AuthUser.fromJson(body as Map<String, dynamic>);
  }

  /// Clears the local token first. If the network call fails, the phone is
  /// still signed out, which is what the person asked for.
  Future<void> signOut() async {
    await _api.clearToken();

    try {
      await _api.post('/auth/logout');
    } catch (_) {
      // Best effort — the session is already gone on this device.
    }
  }

  String _messageFrom(dynamic body, String fallback) {
    if (body is Map && body['message'] != null) return body['message'].toString();
    return fallback;
  }
}

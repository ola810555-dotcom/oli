<?php
declare(strict_types=1);

session_start();

const DB_HOST = '127.0.0.1';
const DB_NAME = 'mensajeria_pastel';
const DB_USER = 'root';
const DB_PASS = '';
const MAX_FILE_BYTES = 16777216;

header_remove('X-Powered-By');

function json_response(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(string $message, int $status = 400): void
{
    json_response(['ok' => false, 'error' => $message], $status);
}

function db(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    try {
        $server = new PDO(
            'mysql:host=' . DB_HOST . ';charset=utf8mb4',
            DB_USER,
            DB_PASS,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]
        );
        $server->exec('CREATE DATABASE IF NOT EXISTS `' . DB_NAME . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');

        $pdo = new PDO(
            'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
            DB_USER,
            DB_PASS,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            ]
        );
        migrate($pdo);
        return $pdo;
    } catch (PDOException $exception) {
        fail('No se pudo conectar a MySQL. Revisa DB_HOST, DB_USER y DB_PASS en app.php.', 500);
    }
}

function migrate(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS users (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(70) NOT NULL,
            phone VARCHAR(15) NOT NULL,
            email VARCHAR(190) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            last_seen DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
    add_column($pdo, 'users', 'last_seen', 'ALTER TABLE users ADD last_seen DATETIME NULL AFTER password_hash');

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS messages (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            body TEXT NULL,
            sticker VARCHAR(16) NULL,
            file_name VARCHAR(255) NULL,
            file_type VARCHAR(120) NULL,
            file_data LONGBLOB NULL,
            recipient_id INT UNSIGNED NULL,
            expires_at DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT NULL,
            INDEX idx_messages_created (created_at),
            INDEX idx_messages_recipient (recipient_id),
            CONSTRAINT fk_messages_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    add_column($pdo, 'messages', 'recipient_id', 'ALTER TABLE messages ADD recipient_id INT UNSIGNED NULL AFTER user_id');
    add_column($pdo, 'messages', 'expires_at', 'ALTER TABLE messages ADD expires_at DATETIME NULL AFTER file_data');
    add_index($pdo, 'messages', 'idx_messages_recipient', 'ALTER TABLE messages ADD INDEX idx_messages_recipient (recipient_id)');

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS statuses (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            note VARCHAR(140) NULL,
            file_name VARCHAR(255) NULL,
            file_type VARCHAR(120) NULL,
            file_data LONGBLOB NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            INDEX idx_statuses_expires (expires_at),
            CONSTRAINT fk_statuses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
}

function add_column(PDO $pdo, string $table, string $column, string $sql): void
{
    $statement = $pdo->prepare(
        "SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?"
    );
    $statement->execute([DB_NAME, $table, $column]);
    if ((int) $statement->fetchColumn() === 0) {
        $pdo->exec($sql);
    }
}

function add_index(PDO $pdo, string $table, string $index, string $sql): void
{
    $statement = $pdo->prepare(
        "SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?"
    );
    $statement->execute([DB_NAME, $table, $index]);
    if ((int) $statement->fetchColumn() === 0) {
        $pdo->exec($sql);
    }
}

function input(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $json = json_decode($raw, true);
    return is_array($json) ? $json : $_POST;
}

function clean_text(?string $value): string
{
    return trim((string) $value);
}

function validate_name(string $name): void
{
    if ($name === '' || !preg_match('/^[\p{L} ]{2,70}$/u', $name)) {
        fail('El nombre solo puede llevar letras y espacios.');
    }
}

function validate_phone(string $phone): void
{
    if (!preg_match('/^[0-9]{7,15}$/', $phone)) {
        fail('El telefono solo puede llevar numeros de 7 a 15 digitos.');
    }
}

function require_user(): array
{
    if (empty($_SESSION['user_id'])) {
        fail('Inicia sesion primero.', 401);
    }

    $statement = db()->prepare('SELECT id, name, phone, email FROM users WHERE id = ?');
    $statement->execute([$_SESSION['user_id']]);
    $user = $statement->fetch();

    if (!$user) {
        session_destroy();
        fail('La sesion ya no es valida.', 401);
    }

    db()->prepare('UPDATE users SET last_seen = NOW() WHERE id = ?')->execute([$user['id']]);
    return $user;
}

function public_user(array $user): array
{
    return [
        'id' => (int) $user['id'],
        'name' => $user['name'],
        'phone' => $user['phone'],
        'email' => $user['email'],
    ];
}

function validate_recipient(int $recipientId, int $senderId): ?int
{
    if ($recipientId <= 0) {
        return null;
    }
    if ($recipientId === $senderId) {
        fail('No puedes enviarte un mensaje directo a tu misma cuenta.');
    }

    $statement = db()->prepare('SELECT id FROM users WHERE id = ?');
    $statement->execute([$recipientId]);
    if (!$statement->fetch()) {
        fail('No se encontro el usuario destino.');
    }

    return $recipientId;
}

function register_user(): void
{
    $data = input();
    $name = clean_text($data['name'] ?? '');
    $phone = clean_text($data['phone'] ?? '');
    $email = strtolower(clean_text($data['email'] ?? ''));
    $password = (string) ($data['password'] ?? '');

    validate_name($name);
    validate_phone($phone);

    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fail('Escribe un correo valido.');
    }
    if (strlen($password) < 6) {
        fail('La contrasena debe tener minimo 6 caracteres.');
    }

    try {
        $statement = db()->prepare('INSERT INTO users (name, phone, email, password_hash) VALUES (?, ?, ?, ?)');
        $statement->execute([$name, $phone, $email, password_hash($password, PASSWORD_DEFAULT)]);
        $_SESSION['user_id'] = (int) db()->lastInsertId();
        json_response(['ok' => true, 'user' => public_user(require_user())]);
    } catch (PDOException $exception) {
        fail('Ese correo ya esta registrado.');
    }
}

function login_user(): void
{
    $data = input();
    $email = strtolower(clean_text($data['email'] ?? ''));
    $password = (string) ($data['password'] ?? '');

    $statement = db()->prepare('SELECT * FROM users WHERE email = ?');
    $statement->execute([$email]);
    $user = $statement->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        fail('Correo o contrasena incorrectos.', 401);
    }

    $_SESSION['user_id'] = (int) $user['id'];
    json_response(['ok' => true, 'user' => public_user($user)]);
}

function list_messages(): void
{
    $user = require_user();
    $recipientId = (int) ($_GET['recipient_id'] ?? 0);

    if ($recipientId > 0) {
        $statement = db()->prepare(
            "SELECT messages.id, messages.user_id, messages.recipient_id, messages.body, messages.sticker,
                    messages.file_name, messages.file_type, users.name AS user_name,
                    DATE_FORMAT(messages.created_at, '%d/%m/%Y %H:%i') AS created_at,
                    IF(messages.expires_at IS NULL, '', DATE_FORMAT(messages.expires_at, '%d/%m/%Y %H:%i')) AS expires_at
             FROM messages
             JOIN users ON users.id = messages.user_id
             WHERE ((messages.user_id = ? AND messages.recipient_id = ?) OR (messages.user_id = ? AND messages.recipient_id = ?))
               AND (messages.expires_at IS NULL OR messages.expires_at > NOW())
             ORDER BY messages.created_at ASC, messages.id ASC
             LIMIT 200"
        );
        $statement->execute([$user['id'], $recipientId, $recipientId, $user['id']]);
        json_response(['ok' => true, 'messages' => $statement->fetchAll()]);
    }

    $statement = db()->query(
        "SELECT messages.id, messages.user_id, messages.body, messages.sticker, messages.file_name,
                messages.file_type, users.name AS user_name,
                DATE_FORMAT(messages.created_at, '%d/%m/%Y %H:%i') AS created_at,
                IF(messages.expires_at IS NULL, '', DATE_FORMAT(messages.expires_at, '%d/%m/%Y %H:%i')) AS expires_at
         FROM messages
         JOIN users ON users.id = messages.user_id
         WHERE messages.recipient_id IS NULL
           AND (messages.expires_at IS NULL OR messages.expires_at > NOW())
         ORDER BY messages.created_at ASC, messages.id ASC
         LIMIT 200"
    );

    json_response(['ok' => true, 'messages' => $statement->fetchAll()]);
}

function create_message(): void
{
    $user = require_user();
    $body = clean_text($_POST['body'] ?? '');
    $sticker = clean_text($_POST['sticker'] ?? '');
    $recipientId = (int) ($_POST['recipient_id'] ?? 0);
    $recipientId = validate_recipient($recipientId, (int) $user['id']);
    $expiresIn = (int) ($_POST['expires_in'] ?? 0);
    $expiresAt = $expiresIn > 0 ? date('Y-m-d H:i:s', time() + min($expiresIn, 604800)) : null;
    $file = normalize_file();

    if ($body === '' && $sticker === '' && !$file) {
        fail('Escribe un mensaje o agrega un archivo.');
    }

    $statement = db()->prepare(
        'INSERT INTO messages (user_id, recipient_id, body, sticker, file_name, file_type, file_data, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $statement->execute([
        $user['id'],
        $recipientId,
        $body,
        $sticker ?: null,
        $file['name'] ?? null,
        $file['type'] ?? null,
        $file['data'] ?? null,
        $expiresAt,
    ]);

    json_response(['ok' => true]);
}

function update_message(): void
{
    $user = require_user();
    $id = (int) ($_POST['editing_id'] ?? 0);
    $body = clean_text($_POST['body'] ?? '');
    $sticker = clean_text($_POST['sticker'] ?? '');
    $expiresIn = (int) ($_POST['expires_in'] ?? 0);
    $expiresAt = $expiresIn > 0 ? date('Y-m-d H:i:s', time() + min($expiresIn, 604800)) : null;
    $file = normalize_file();

    if ($id <= 0) {
        fail('Mensaje invalido.');
    }

    if ($file) {
        $statement = db()->prepare(
            'UPDATE messages SET body = ?, sticker = ?, file_name = ?, file_type = ?, file_data = ?, expires_at = ?, updated_at = NOW() WHERE id = ? AND user_id = ?'
        );
        $statement->execute([$body, $sticker ?: null, $file['name'], $file['type'], $file['data'], $expiresAt, $id, $user['id']]);
    } else {
        $statement = db()->prepare('UPDATE messages SET body = ?, sticker = ?, expires_at = ?, updated_at = NOW() WHERE id = ? AND user_id = ?');
        $statement->execute([$body, $sticker ?: null, $expiresAt, $id, $user['id']]);
    }

    if ($statement->rowCount() === 0) {
        fail('No se encontro el mensaje o no es tuyo.', 404);
    }

    json_response(['ok' => true]);
}

function delete_message(): void
{
    $user = require_user();
    $data = input();
    $id = (int) ($data['id'] ?? 0);

    $statement = db()->prepare('DELETE FROM messages WHERE id = ? AND user_id = ?');
    $statement->execute([$id, $user['id']]);
    json_response(['ok' => true]);
}

function normalize_file(): ?array
{
    if (empty($_FILES['file']) || $_FILES['file']['error'] === UPLOAD_ERR_NO_FILE) {
        return null;
    }

    if ($_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        fail('No se pudo subir el archivo.');
    }

    if ($_FILES['file']['size'] > MAX_FILE_BYTES) {
        fail('El archivo no puede pesar mas de 16 MB.');
    }

    $name = basename((string) $_FILES['file']['name']);
    $type = mime_content_type($_FILES['file']['tmp_name']) ?: 'application/octet-stream';

    return [
        'name' => $name,
        'type' => $type,
        'data' => file_get_contents($_FILES['file']['tmp_name']),
    ];
}

function send_file(): void
{
    $user = require_user();
    $id = (int) ($_GET['id'] ?? 0);
    $statement = db()->prepare(
        'SELECT file_name, file_type, file_data FROM messages
         WHERE id = ? AND file_data IS NOT NULL
           AND (recipient_id IS NULL OR user_id = ? OR recipient_id = ?)'
    );
    $statement->execute([$id, $user['id'], $user['id']]);
    $file = $statement->fetch();

    if (!$file) {
        http_response_code(404);
        exit;
    }

    header('Content-Type: ' . $file['file_type']);
    header('Content-Disposition: inline; filename="' . str_replace('"', '', $file['file_name']) . '"');
    echo $file['file_data'];
    exit;
}

function send_status_file(): void
{
    require_user();
    $id = (int) ($_GET['id'] ?? 0);
    $statement = db()->prepare('SELECT file_name, file_type, file_data FROM statuses WHERE id = ? AND file_data IS NOT NULL AND expires_at > NOW()');
    $statement->execute([$id]);
    $file = $statement->fetch();

    if (!$file) {
        http_response_code(404);
        exit;
    }

    header('Content-Type: ' . $file['file_type']);
    header('Content-Disposition: inline; filename="' . str_replace('"', '', $file['file_name']) . '"');
    echo $file['file_data'];
    exit;
}

function search_users(): void
{
    $user = require_user();
    $term = clean_text($_GET['q'] ?? '');

    if ($term === '' || !preg_match('/^[\p{L} ]{1,70}$/u', $term)) {
        json_response(['ok' => true, 'users' => []]);
    }

    $statement = db()->prepare(
        "SELECT id, name, email,
                IF(last_seen >= DATE_SUB(NOW(), INTERVAL 2 MINUTE), 1, 0) AS online
         FROM users
         WHERE id <> ? AND name LIKE ?
         ORDER BY online DESC, name ASC
         LIMIT 20"
    );
    $statement->execute([$user['id'], '%' . $term . '%']);
    json_response(['ok' => true, 'users' => $statement->fetchAll()]);
}

function list_chats(): void
{
    $user = require_user();
    $statement = db()->prepare(
        "SELECT u.id, u.name, u.email,
                IF(u.last_seen >= DATE_SUB(NOW(), INTERVAL 2 MINUTE), 1, 0) AS online,
                DATE_FORMAT(MAX(m.created_at), '%d/%m %H:%i') AS last_time,
                SUBSTRING_INDEX(
                    GROUP_CONCAT(COALESCE(NULLIF(m.body, ''), m.file_name, 'Archivo') ORDER BY m.created_at DESC SEPARATOR '|||'),
                    '|||',
                    1
                ) AS last_message
         FROM users u
         JOIN messages m
           ON ((m.user_id = ? AND m.recipient_id = u.id) OR (m.user_id = u.id AND m.recipient_id = ?))
         WHERE u.id <> ?
           AND (m.expires_at IS NULL OR m.expires_at > NOW())
         GROUP BY u.id, u.name, u.email, u.last_seen
         ORDER BY MAX(m.created_at) DESC
         LIMIT 40"
    );
    $statement->execute([$user['id'], $user['id'], $user['id']]);
    json_response(['ok' => true, 'chats' => $statement->fetchAll()]);
}

function list_statuses(): void
{
    require_user();
    $statement = db()->query(
        "SELECT statuses.id, statuses.user_id, statuses.note, statuses.file_name, statuses.file_type,
                users.name AS user_name, DATE_FORMAT(statuses.created_at, '%d/%m %H:%i') AS created_at
         FROM statuses
         JOIN users ON users.id = statuses.user_id
         WHERE statuses.expires_at > NOW()
         ORDER BY statuses.created_at DESC
         LIMIT 30"
    );
    json_response(['ok' => true, 'statuses' => $statement->fetchAll()]);
}

function create_status(): void
{
    $user = require_user();
    $note = clean_text($_POST['note'] ?? '');
    $file = normalize_file();

    if ($note === '' && !$file) {
        fail('Escribe una nota o sube un archivo para el estado.');
    }

    $statement = db()->prepare(
        'INSERT INTO statuses (user_id, note, file_name, file_type, file_data, expires_at) VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))'
    );
    $statement->execute([
        $user['id'],
        $note ?: null,
        $file['name'] ?? null,
        $file['type'] ?? null,
        $file['data'] ?? null,
    ]);

    json_response(['ok' => true]);
}

function update_account(): void
{
    $user = require_user();
    $data = input();
    $name = clean_text($data['name'] ?? '');
    $phone = clean_text($data['phone'] ?? '');

    validate_name($name);
    validate_phone($phone);

    $statement = db()->prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?');
    $statement->execute([$name, $phone, $user['id']]);
    json_response(['ok' => true, 'user' => public_user(require_user())]);
}

function delete_account(): void
{
    $user = require_user();
    $statement = db()->prepare('DELETE FROM users WHERE id = ?');
    $statement->execute([$user['id']]);
    session_destroy();
    json_response(['ok' => true]);
}

function reset_all_accounts(): void
{
    $pdo = db();
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
    $pdo->exec('TRUNCATE TABLE statuses');
    $pdo->exec('TRUNCATE TABLE messages');
    $pdo->exec('TRUNCATE TABLE users');
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
    session_destroy();
    json_response(['ok' => true, 'message' => 'Cuentas y mensajes existentes borrados.']);
}

$action = $_GET['action'] ?? '';

switch ($action) {
    case 'file':
        send_file();
        break;
    case 'status_file':
        send_status_file();
        break;
    case 'me':
        json_response(['ok' => true, 'user' => empty($_SESSION['user_id']) ? null : public_user(require_user())]);
        break;
    case 'register':
        register_user();
        break;
    case 'login':
        login_user();
        break;
    case 'logout':
        session_destroy();
        json_response(['ok' => true]);
        break;
    case 'messages':
        list_messages();
        break;
    case 'search_users':
        search_users();
        break;
    case 'chats':
        list_chats();
        break;
    case 'statuses':
        list_statuses();
        break;
    case 'create_status':
        create_status();
        break;
    case 'create_message':
        create_message();
        break;
    case 'update_message':
        update_message();
        break;
    case 'delete_message':
        delete_message();
        break;
    case 'update_account':
        update_account();
        break;
    case 'delete_account':
        delete_account();
        break;
    case 'reset_accounts':
        reset_all_accounts();
        break;
    default:
        fail('Accion no valida.', 404);
}

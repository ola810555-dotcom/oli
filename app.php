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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS messages (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            user_id INT UNSIGNED NOT NULL,
            body TEXT NULL,
            sticker VARCHAR(16) NULL,
            file_name VARCHAR(255) NULL,
            file_type VARCHAR(120) NULL,
            file_data LONGBLOB NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NULL DEFAULT NULL,
            INDEX idx_messages_created (created_at),
            CONSTRAINT fk_messages_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );
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
    require_user();
    $statement = db()->query(
        "SELECT messages.id, messages.user_id, messages.body, messages.sticker, messages.file_name,
                messages.file_type, users.name AS user_name,
                DATE_FORMAT(messages.created_at, '%d/%m/%Y %H:%i') AS created_at
         FROM messages
         JOIN users ON users.id = messages.user_id
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
    $file = normalize_file();

    if ($body === '' && $sticker === '' && !$file) {
        fail('Escribe un mensaje o agrega un archivo.');
    }

    $statement = db()->prepare(
        'INSERT INTO messages (user_id, body, sticker, file_name, file_type, file_data) VALUES (?, ?, ?, ?, ?, ?)'
    );
    $statement->execute([
        $user['id'],
        $body,
        $sticker ?: null,
        $file['name'] ?? null,
        $file['type'] ?? null,
        $file['data'] ?? null,
    ]);

    json_response(['ok' => true]);
}

function update_message(): void
{
    $user = require_user();
    $id = (int) ($_POST['editing_id'] ?? 0);
    $body = clean_text($_POST['body'] ?? '');
    $sticker = clean_text($_POST['sticker'] ?? '');
    $file = normalize_file();

    if ($id <= 0) {
        fail('Mensaje invalido.');
    }

    if ($file) {
        $statement = db()->prepare(
            'UPDATE messages SET body = ?, sticker = ?, file_name = ?, file_type = ?, file_data = ?, updated_at = NOW() WHERE id = ? AND user_id = ?'
        );
        $statement->execute([$body, $sticker ?: null, $file['name'], $file['type'], $file['data'], $id, $user['id']]);
    } else {
        $statement = db()->prepare('UPDATE messages SET body = ?, sticker = ?, updated_at = NOW() WHERE id = ? AND user_id = ?');
        $statement->execute([$body, $sticker ?: null, $id, $user['id']]);
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
    require_user();
    $id = (int) ($_GET['id'] ?? 0);
    $statement = db()->prepare('SELECT file_name, file_type, file_data FROM messages WHERE id = ? AND file_data IS NOT NULL');
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

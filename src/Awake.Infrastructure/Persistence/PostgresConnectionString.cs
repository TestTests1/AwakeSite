using Npgsql;

namespace Awake.Infrastructure.Persistence;

/// <summary>
/// Приводит строку подключения к виду, который понимает Npgsql.
///
/// Хостинги — Railway, Heroku, Render — отдают адрес базы одной ссылкой вида
/// <c>postgresql://пользователь:пароль@хост:порт/база</c>, а Npgsql принимает
/// только запись из пар «ключ=значение». Без разбора ссылки приходится собирать
/// строку вручную из четырёх отдельных переменных, и любая опечатка в имени
/// сервиса даёт пустое подключение с невнятной ошибкой.
///
/// Строка в привычном формате возвращается как есть, так что стенд и
/// docker-compose ничего не замечают.
/// </summary>
public static class PostgresConnectionString
{
    private const int DefaultPort = 5432;

    private static readonly string[] UriPrefixes = ["postgres://", "postgresql://"];

    public static string Normalize(string value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return value;

        var trimmed = value.Trim();
        if (!UriPrefixes.Any(p => trimmed.StartsWith(p, StringComparison.OrdinalIgnoreCase)))
            return value;

        var uri = new Uri(trimmed);

        // Пароль в ссылке закодирован по правилам URL: без раскодирования
        // символы вроде %40 уехали бы в пароль буквально.
        var credentials = uri.UserInfo.Split(':', 2);

        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            // для незнакомой схемы .NET отдаёт -1, когда порт не указан явно
            Port = uri.Port < 0 ? DefaultPort : uri.Port,
            Database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/')),
            Username = Uri.UnescapeDataString(credentials[0]),
        };

        if (credentials.Length > 1)
            builder.Password = Uri.UnescapeDataString(credentials[1]);

        ApplySslMode(builder, uri.Query);

        return builder.ConnectionString;
    }

    /// <summary>
    /// Переносит sslmode из ссылки. Остальные параметры запроса игнорируем
    /// намеренно: у платформ они свои, и вслепую переносить их в Npgsql нельзя.
    /// </summary>
    private static void ApplySslMode(NpgsqlConnectionStringBuilder builder, string query)
    {
        if (string.IsNullOrEmpty(query))
            return;

        foreach (var pair in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = pair.Split('=', 2);
            if (parts.Length != 2 || !parts[0].Equals("sslmode", StringComparison.OrdinalIgnoreCase))
                continue;

            builder.SslMode = parts[1].ToLowerInvariant() switch
            {
                "disable" => SslMode.Disable,
                "allow" => SslMode.Allow,
                "prefer" => SslMode.Prefer,
                "require" => SslMode.Require,
                "verify-ca" => SslMode.VerifyCA,
                "verify-full" => SslMode.VerifyFull,
                _ => builder.SslMode,
            };

            // Require означает «шифруй, но цепочку не проверяй». У Railway и
            // подобных сертификат самоподписанный, и без этого соединение
            // рвётся на проверке.
            if (builder.SslMode == SslMode.Require)
                builder.TrustServerCertificate = true;
        }
    }
}

using Awake.Infrastructure.Persistence;
using FluentAssertions;
using Npgsql;

namespace Awake.Unit.Tests.Infrastructure;

public class PostgresConnectionStringTests
{
    private static NpgsqlConnectionStringBuilder Parse(string value) => new(PostgresConnectionString.Normalize(value));

    [Fact]
    public void Normalize_PlainConnectionString_ReturnedAsIs()
    {
        // так строка приходит на стенде и в docker-compose — трогать её нельзя
        const string plain = "Host=localhost;Port=5432;Database=awake_dev;Username=postgres;Password=secret";

        PostgresConnectionString.Normalize(plain).Should().Be(plain);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Normalize_Blank_ReturnedAsIs(string value)
    {
        PostgresConnectionString.Normalize(value).Should().Be(value);
    }

    [Theory]
    [InlineData("postgresql://")]
    [InlineData("postgres://")]
    public void Normalize_UriForm_IsParsed(string scheme)
    {
        var result = Parse($"{scheme}awake:hunter2@db.railway.internal:5432/railway");

        result.Host.Should().Be("db.railway.internal");
        result.Port.Should().Be(5432);
        result.Database.Should().Be("railway");
        result.Username.Should().Be("awake");
        result.Password.Should().Be("hunter2");
    }

    [Fact]
    public void Normalize_UriWithoutPort_UsesDefault()
    {
        // для незнакомой схемы .NET отдаёт -1, и без подстановки порт уехал бы битым
        Parse("postgresql://awake:hunter2@db.railway.internal/railway").Port.Should().Be(5432);
    }

    [Fact]
    public void Normalize_NonStandardPort_IsKept()
    {
        // именно так выглядит адрес внешнего TCP-прокси
        Parse("postgresql://awake:hunter2@shuttle.proxy.rlwy.net:41234/railway").Port.Should().Be(41234);
    }

    [Fact]
    public void Normalize_EncodedPassword_IsDecoded()
    {
        // пароль в ссылке закодирован по правилам URL: %40 это @, %2F это /
        Parse("postgresql://awake:p%40ss%2Fword@host/railway").Password.Should().Be("p@ss/word");
    }

    [Fact]
    public void Normalize_EncodedUsername_IsDecoded()
    {
        Parse("postgresql://awake%40clan:secret@host/railway").Username.Should().Be("awake@clan");
    }

    [Fact]
    public void Normalize_WithoutPassword_LeavesItUnset()
    {
        Parse("postgresql://awake@host/railway").Password.Should().BeNullOrEmpty();
    }

    [Theory]
    [InlineData("disable", SslMode.Disable)]
    [InlineData("prefer", SslMode.Prefer)]
    [InlineData("require", SslMode.Require)]
    [InlineData("verify-full", SslMode.VerifyFull)]
    public void Normalize_SslModeFromQuery_IsApplied(string mode, SslMode expected)
    {
        Parse($"postgresql://awake:secret@host/railway?sslmode={mode}").SslMode.Should().Be(expected);
    }

    [Fact]
    public void Normalize_SslModeRequire_TrustsCertificate()
    {
        // сертификат у таких хостингов самоподписанный: без этого рвётся на проверке
        Parse("postgresql://awake:secret@host/railway?sslmode=require")
            .TrustServerCertificate.Should().BeTrue();
    }

    [Fact]
    public void Normalize_UnknownQueryParameters_AreIgnored()
    {
        var result = Parse("postgresql://awake:secret@host/railway?connect_timeout=10&application_name=x");

        result.Host.Should().Be("host");
        result.Database.Should().Be("railway");
    }

    [Fact]
    public void Normalize_IsCaseInsensitiveAboutScheme()
    {
        Parse("POSTGRESQL://awake:secret@host/railway").Host.Should().Be("host");
    }
}

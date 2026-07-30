using Awake.Application.Common.Interfaces;
using Awake.Application.Common.Interfaces.Repositories;
using Awake.Infrastructure.ExternalServices.Discord;
using Awake.Infrastructure.ExternalServices.Items;
using Awake.Infrastructure.ExternalServices.Maps;
using Awake.Infrastructure.ExternalServices.PlayerData;
using Awake.Infrastructure.ExternalServices.PlayerData.Sources;
using Awake.Infrastructure.Identity;
using Awake.Infrastructure.Persistence;
using Awake.Infrastructure.Persistence.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Awake.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // Database
        //
        // Пустую строку подключения ловим здесь, а не оставляем Npgsql: он падает
        // уже на миграциях, стеком в пятнадцать строк и сообщением про «сервер ''»,
        // по которому не догадаться, что дело просто в незаданной переменной.
        var connectionString = configuration.GetConnectionString("Postgres");
        if (string.IsNullOrWhiteSpace(connectionString))
            throw new InvalidOperationException(EmptyConnectionStringMessage(configuration));

        // принимаем и ссылку postgresql://…, какой её отдают хостинги
        services.AddDbContext<AppDbContext>(opt =>
            opt.UseNpgsql(PostgresConnectionString.Normalize(connectionString)));

        // Repositories
        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<ISquadRepository, SquadRepository>();
        services.AddScoped<ITicketRepository, TicketRepository>();
        services.AddScoped<IRefreshTokenRepository, RefreshTokenRepository>();
        services.AddScoped<INotificationRepository, NotificationRepository>();
        services.AddScoped<IDiscordGuildSettingsRepository, DiscordGuildSettingsRepository>();
        services.AddScoped<IPlayerStatsSnapshotRepository, PlayerStatsSnapshotRepository>();
        services.AddScoped<IPlayerInventoryRepository, PlayerInventoryRepository>();
        services.AddScoped<IPlayerBuildProofRepository, PlayerBuildProofRepository>();
        services.AddScoped<IPlayerBoostRequestRepository, PlayerBoostRequestRepository>();
        services.AddScoped<IMapLayoutRepository, MapLayoutRepository>();

        // Discord
        services.AddHttpClient<IDiscordNotifier, DiscordNotifier>();
        services.AddHttpClient<IDiscordBotService, DiscordBotService>();
        services.AddHttpClient<IDiscordOAuthService, DiscordOAuthService>();
        services.AddHostedService<DiscordGatewayService>();
        services.AddSingleton<IDiscordRoleSyncSettings, DiscordRoleSyncSettings>();

        // Items cache
        services.AddHttpClient("stalzone");
        services.AddSingleton<IItemCacheService, ItemCacheService>();
        services.AddHostedService<ItemSyncHostedService>();

        // Player data — primary: stalzone.wiki (Playwright), fallback: stalcrafthq.com (FlareSolverr)
        services.AddSingleton<StalzoneWikiDataSource>();
        services.AddSingleton<IPlayerDataSource>(sp => sp.GetRequiredService<StalzoneWikiDataSource>());

        var flareSolverrUrl = configuration["PlayerData:FlareSolverrUrl"];
        if (!string.IsNullOrWhiteSpace(flareSolverrUrl))
        {
            services.AddHttpClient("flaresolverr", c => c.BaseAddress = new Uri(flareSolverrUrl));
            // UseCookies=false so we can forward CF clearance cookies manually in the header
            services.AddHttpClient("stalcrafthq-api")
                .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { UseCookies = false });
            services.AddTransient<StalcraftHqDataSource>();
            services.AddTransient<IPlayerDataSource>(sp => sp.GetRequiredService<StalcraftHqDataSource>());
        }

        services.AddSingleton<IPlayerDataAggregator, PlayerDataAggregator>();

        // Identity services
        services.AddScoped<IPasswordHasher, PasswordHasherService>();
        services.AddScoped<ITokenService, TokenService>();
        services.AddScoped<ICurrentUserService, CurrentUserService>();

        services.AddHttpContextAccessor();

        // Карты (3D-вьюер)
        services.AddSingleton<IMapAssetService, MapAssetService>();

        return services;
    }

    /// <summary>
    /// Настройки, которые обязаны прийти снаружи в рабочем окружении. Нужны не
    /// сами по себе, а как срез: если пусто всё разом — переменные заданы не тому
    /// сервису или не в том окружении, и искать опечатку в одном имени бесполезно.
    /// </summary>
    private static readonly string[] ExpectedSettings =
    [
        "ConnectionStrings:Postgres",
        "Jwt:Secret",
        "Discord:BotToken",
        "Discord:OAuthRedirectUri",
        "Cors:AllowedOrigin",
        "MapAssets:BaseUrl",
    ];

    /// <summary>
    /// Объясняет пустую строку подключения и заодно показывает, что вообще
    /// доехало до приложения. Печатаются только имена и признак «задано» —
    /// значения тут секретные, в журнал им нельзя.
    /// </summary>
    private static string EmptyConnectionStringMessage(IConfiguration configuration)
    {
        var seen = ExpectedSettings.Select(key =>
            $"{key.Replace(':', '_').Replace("_", "__")}=" +
            (string.IsNullOrWhiteSpace(configuration[key]) ? "нет" : "задано"));

        return "Строка подключения к базе пуста. Задайте ConnectionStrings__Postgres "
            + "(двойное подчёркивание — это запись ConnectionStrings:Postgres в виде "
            + "переменной окружения). Как её собрать на Railway — docs/deploy-railway.md.\n"
            + "Что видно приложению: " + string.Join(", ", seen) + ".\n"
            + "Если «нет» стоит у всех — переменные заданы другому сервису или в другом "
            + "окружении, и дело не в имени одной из них.";
    }
}

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
        {
            throw new InvalidOperationException(
                "Строка подключения к базе пуста. Задайте ConnectionStrings__Postgres " +
                "(двойное подчёркивание — это запись ConnectionStrings:Postgres в виде " +
                "переменной окружения). Как её собрать на Railway — docs/deploy-railway.md.");
        }

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
}

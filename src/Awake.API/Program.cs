using Awake.API.Extensions;
using Awake.API.Hubs;
using Awake.API.Middleware;
using Awake.API.Services;
using Awake.Application;
using Awake.Application.Common.Interfaces;
using Awake.Infrastructure;
using Awake.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

// 1. Application + Infrastructure layers
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);

// 2. API
builder.Services.AddControllers();
builder.Services.AddMemoryCache();
builder.Services.AddJwtAuthentication(builder.Configuration);
builder.Services.AddRateLimitingPolicies();
builder.Services.AddCorsPolicies(builder.Configuration);

// 3. SignalR
builder.Services.AddSignalR();
builder.Services.AddScoped<INotificationService, NotificationService>();
// присутствие на картах живёт в памяти процесса, поэтому синглтон
builder.Services.AddSingleton<IWorldPresence, WorldPresence>();

// 4. Swagger
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// 5. Serilog
builder.Host.UseSerilog((ctx, cfg) =>
    cfg.ReadFrom.Configuration(ctx.Configuration).WriteTo.Console());

var app = builder.Build();

// 6. Middleware pipeline (order matters)
app.UseMiddleware<GlobalExceptionMiddleware>();
app.UseSerilogRequestLogging();
app.UseHttpsRedirection();
app.UseCors("AllowFrontend");
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHub<NotificationHub>("/hubs/notifications");
app.MapHub<WorldHub>("/hubs/world");

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// 7. Apply EF Core migrations on startup (safe — idempotent)
await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    await db.Database.MigrateAsync();
}

// 8. Auto-register Discord slash commands on startup
await RegisterDiscordCommandsAsync(app);

// 9. Модели локаций: в образ они не входят, поэтому без адреса хранилища вкладка
// «Мир» просто отдаёт 404. Ошибка тихая и всплывает только у игрока, так что
// говорим о ней сразу при старте.
WarnIfMapAssetsUnavailable(app);

app.Run();

static void WarnIfMapAssetsUnavailable(WebApplication app)
{
    var config = app.Services.GetRequiredService<IConfiguration>();
    var logger = app.Services.GetRequiredService<ILogger<Program>>();

    if (!string.IsNullOrWhiteSpace(config["MapAssets:BaseUrl"]))
        return;

    var directory = Path.Combine(app.Environment.ContentRootPath, "MapAssets");
    var models = Directory.Exists(directory) ? Directory.GetFiles(directory, "*.glb").Length : 0;
    if (models > 0)
    {
        logger.LogInformation("Модели локаций раздаются с диска: {Count} шт. в {Directory}", models, directory);
        return;
    }

    logger.LogWarning(
        "Моделей локаций нет ни на диске ({Directory}), ни во внешнем хранилище: "
        + "MapAssets:BaseUrl не задан. Вкладка «Мир» будет отвечать 404.",
        directory);
}

// ── Discord command registration ─────────────────────────────────────────────

static async Task RegisterDiscordCommandsAsync(WebApplication app)
{
    var config = app.Services.GetRequiredService<IConfiguration>();
    var logger = app.Services.GetRequiredService<ILogger<Program>>();

    var botToken = config["Discord:BotToken"];
    var appId    = config["Discord:ApplicationId"];
    var guildId  = config["Discord:GuildId"];

    if (string.IsNullOrWhiteSpace(botToken) || string.IsNullOrWhiteSpace(appId))
    {
        logger.LogInformation("Discord credentials not configured — skipping command registration.");
        return;
    }

    // Guild commands propagate instantly; global commands take up to 1 hour
    var baseUrl = !string.IsNullOrWhiteSpace(guildId)
        ? $"https://discord.com/api/v10/applications/{appId}/guilds/{guildId}/commands"
        : $"https://discord.com/api/v10/applications/{appId}/commands";

    try
    {
        using var http = new HttpClient();
        http.DefaultRequestHeaders.Add("Authorization", $"Bot {botToken}");

        var commands = DiscordSlashCommands.Build();

        foreach (var cmd in commands)
        {
            var resp = await http.PostAsJsonAsync(baseUrl, cmd);
            if (!resp.IsSuccessStatusCode)
                logger.LogWarning("Failed to register Discord command: {Status}", resp.StatusCode);
        }

        logger.LogInformation("Discord slash commands registered successfully (scope: {Scope}).",
            guildId is not null ? $"guild {guildId}" : "global");
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Failed to register Discord slash commands on startup.");
    }
}


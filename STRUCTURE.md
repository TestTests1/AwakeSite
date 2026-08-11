# STRUCTURE.md — Техническая карта проекта Awake

> Этот файл — внутренняя шпаргалка разработчика. Описывает всё: от структуры папок до того, как именно регистрировать сервисы и обрабатывать ошибки. При любых сомнениях "как сделать" — смотреть сюда.

---

## Солюшен

```
Awake.slnx
├── src/
│   ├── Awake.Domain/
│   ├── Awake.Application/
│   ├── Awake.Infrastructure/
│   └── Awake.API/
├── tests/
│   ├── Awake.Unit.Tests/
│   └── Awake.Integration.Tests/
└── frontend/                  ← Next.js проект
    └── awake-web/
```

---

## Правило зависимостей (Clean Architecture)

```
Domain          ← ни от кого не зависит
Application     ← зависит только от Domain
Infrastructure  ← зависит от Application + Domain
API             ← зависит от Application + Infrastructure (только для DI)
```

Нельзя: Application → Infrastructure, Domain → Application.

---

## Awake.Domain

Только бизнес-сущности, перечисления и доменные исключения. Никаких EF, никаких HTTP, никаких NuGet кроме базовых.

### Структура папок

```
Awake.Domain/
├── Entities/
│   ├── User.cs
│   ├── Squad.cs
│   ├── SquadMember.cs
│   ├── Ticket.cs
│   └── TicketComment.cs
├── Enums/
│   ├── UserRank.cs
│   └── TicketStatus.cs
│   └── TicketType.cs
├── Exceptions/
│   ├── DomainException.cs
│   ├── NotFoundException.cs
│   └── ForbiddenException.cs
└── Common/
    └── BaseEntity.cs
```

### Entities

```csharp
// BaseEntity.cs
public abstract class BaseEntity
{
    public Guid Id { get; init; } = Guid.NewGuid();
    public DateTime CreatedAt { get; init; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}

// User.cs
public class User : BaseEntity
{
    public string Username { get; set; }        // уникальный логин
    public string PasswordHash { get; set; }    // bcrypt через ASP.NET Identity
    public string? Email { get; set; }          // опционально
    public UserRank Rank { get; set; } = UserRank.Guest;
    public string? GameNickname { get; set; }   // никнейм в STALCRAFT
    public ICollection<SquadMember> SquadMemberships { get; set; } = [];
    public ICollection<Ticket> Tickets { get; set; } = [];
}

// Squad.cs
public class Squad : BaseEntity
{
    public string Name { get; set; }
    public int Number { get; set; }             // 1–5, уникальный
    public ICollection<SquadMember> Members { get; set; } = [];
}

// SquadMember.cs — связь User ↔ Squad
public class SquadMember : BaseEntity
{
    public Guid SquadId { get; set; }
    public Squad Squad { get; set; }
    public Guid UserId { get; set; }
    public User User { get; set; }
    public bool IsLeader { get; set; } = false; // не ранг, флаг
    public DateTime JoinedAt { get; init; } = DateTime.UtcNow;
}

// Ticket.cs
public class Ticket : BaseEntity
{
    public Guid AuthorId { get; set; }
    public User Author { get; set; }
    public string GameNickname { get; set; }    // никнейм заявителя в игре
    public TicketType Type { get; set; }
    public TicketStatus Status { get; set; } = TicketStatus.Pending;
    public string Description { get; set; }
    public Guid? ReviewedBy { get; set; }       // кто рассматривал (officer+)
    public DateTime? ReviewedAt { get; set; }
    public ICollection<TicketComment> Comments { get; set; } = [];
}

// TicketComment.cs — внутренние комментарии officer+
public class TicketComment : BaseEntity
{
    public Guid TicketId { get; set; }
    public Ticket Ticket { get; set; }
    public Guid AuthorId { get; set; }
    public User Author { get; set; }
    public string Content { get; set; }
}
```

### Enums

```csharp
// UserRank.cs — порядок важен для сравнения (Guest < Member < Officer < Colonel < Leader)
public enum UserRank { Guest = 0, Member = 1, Officer = 2, Colonel = 3, Leader = 4 }

// TicketStatus.cs
public enum TicketStatus { Pending, InReview, Approved, Rejected }

// TicketType.cs
public enum TicketType { Recruitment, Appeal }
```

### Exceptions

```csharp
// DomainException.cs — базовый, для нарушений бизнес-правил
public class DomainException(string message) : Exception(message);

// NotFoundException.cs
public class NotFoundException(string entity, object key)
    : DomainException($"{entity} с идентификатором '{key}' не найден.");

// ForbiddenException.cs
public class ForbiddenException(string message = "Недостаточно прав.")
    : DomainException(message);
```

---

## Awake.Application

Бизнес-логика. MediatR Commands/Queries, интерфейсы репозиториев, DTOs, Pipeline Behaviors. Не знает о EF Core, HTTP, конкретных БД.

### Структура папок

```
Awake.Application/
├── Common/
│   ├── Interfaces/
│   │   ├── Repositories/
│   │   │   ├── IUserRepository.cs
│   │   │   ├── ISquadRepository.cs
│   │   │   └── ITicketRepository.cs
│   │   ├── IDiscordNotifier.cs
│   │   ├── IPlayerDataAggregator.cs   ← внешние сайты верификации
│   │   └── ICurrentUserService.cs     ← кто сейчас авторизован
│   ├── Behaviors/
│   │   ├── ValidationBehavior.cs
│   │   └── LoggingBehavior.cs
│   └── Models/
│       └── Result.cs                  ← Result<T> паттерн
├── Features/
│   ├── Auth/
│   │   ├── DiscordLogin/
│   │   │   ├── DiscordLoginCommand.cs
│   │   │   └── DiscordLoginCommandHandler.cs
│   │   ├── Login/
│   │   │   └── LoginResponse.cs
│   │   └── Refresh/
│   │       ├── RefreshCommand.cs
│   │       ├── RefreshCommandHandler.cs
│   │       ├── RefreshCommandValidator.cs
│   │       └── RefreshResponse.cs
│   ├── Squads/
│   │   ├── GetSquads/
│   │   │   ├── GetSquadsQuery.cs
│   │   │   ├── GetSquadsQueryHandler.cs
│   │   │   └── SquadDto.cs
│   │   ├── GetSquadById/
│   │   ├── AddSquadMember/
│   │   ├── RemoveSquadMember/
│   │   └── SetSquadLeader/
│   ├── Tickets/
│   │   ├── CreateTicket/
│   │   │   ├── CreateTicketCommand.cs
│   │   │   ├── CreateTicketCommandHandler.cs
│   │   │   ├── CreateTicketCommandValidator.cs
│   │   │   └── CreateTicketResponse.cs
│   │   ├── GetTickets/
│   │   ├── GetTicketById/       ← здесь дёргаем IPlayerDataAggregator
│   │   ├── UpdateTicketStatus/
│   │   └── AddTicketComment/
│   ├── Users/
│   │   ├── GetUsers/
│   │   └── UpdateUserRank/
│   └── Stats/
│       ├── GetClanStats/
│       └── GetPlayerStats/      ← агрегация с внешних сайтов
└── DependencyInjection.cs       ← регистрация MediatR, Behaviors, Validators
```

### Result<T> — паттерн ошибок

```csharp
// Используется во всех Handler'ах вместо исключений для ожидаемых ошибок.
// Domain Exceptions бросаются для нарушений бизнес-правил (перехватывает Middleware).

public class Result<T>
{
    public bool IsSuccess { get; }
    public T? Value { get; }
    public string? Error { get; }

    private Result(T value) { IsSuccess = true; Value = value; }
    private Result(string error) { IsSuccess = false; Error = error; }

    public static Result<T> Success(T value) => new(value);
    public static Result<T> Failure(string error) => new(error);
}
```

### Пример команды (паттерн для всех фичей)

```csharp
// CreateTicketCommand.cs
public record CreateTicketCommand(
    Guid AuthorId,
    string GameNickname,
    TicketType Type,
    string Description
) : IRequest<Result<CreateTicketResponse>>;

// CreateTicketCommandHandler.cs
public class CreateTicketCommandHandler(
    ITicketRepository ticketRepository,
    IDiscordNotifier discordNotifier
) : IRequestHandler<CreateTicketCommand, Result<CreateTicketResponse>>
{
    public async Task<Result<CreateTicketResponse>> Handle(
        CreateTicketCommand request,
        CancellationToken cancellationToken)
    {
        // 1. Бизнес-логика
        var ticket = new Ticket { ... };

        // 2. Сохранение
        await ticketRepository.AddAsync(ticket, cancellationToken);

        // 3. Побочные эффекты
        await discordNotifier.NotifyNewTicketAsync(ticket, cancellationToken);

        return Result<CreateTicketResponse>.Success(new CreateTicketResponse(ticket.Id));
    }
}

// CreateTicketCommandValidator.cs
public class CreateTicketCommandValidator : AbstractValidator<CreateTicketCommand>
{
    public CreateTicketCommandValidator()
    {
        RuleFor(x => x.GameNickname).NotEmpty().MaximumLength(50);
        RuleFor(x => x.Description).NotEmpty().MaximumLength(1000);
    }
}
```

### Pipeline Behaviors

```csharp
// ValidationBehavior.cs — запускается первым, до Handler'а
// Берёт все IValidator<TRequest>, запускает, при ошибке бросает ValidationException.
// Global Middleware поймает и вернёт 400.

// LoggingBehavior.cs — логирует имя команды, время выполнения, успех/ошибку
```

### Interfaces

```csharp
// IUserRepository.cs
public interface IUserRepository
{
    Task<User?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<User?> GetByUsernameAsync(string username, CancellationToken ct = default);
    Task<bool> ExistsByUsernameAsync(string username, CancellationToken ct = default);
    Task AddAsync(User user, CancellationToken ct = default);
    Task UpdateAsync(User user, CancellationToken ct = default);
    Task<IReadOnlyList<User>> GetAllAsync(CancellationToken ct = default);
}

// ISquadRepository.cs
public interface ISquadRepository
{
    Task<Squad?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<Squad?> GetByNumberAsync(int number, CancellationToken ct = default);
    Task<IReadOnlyList<Squad>> GetAllWithMembersAsync(CancellationToken ct = default);
    Task<int> GetMemberCountAsync(Guid squadId, CancellationToken ct = default);
    Task AddMemberAsync(SquadMember member, CancellationToken ct = default);
    Task RemoveMemberAsync(Guid squadId, Guid userId, CancellationToken ct = default);
    Task UpdateMemberAsync(SquadMember member, CancellationToken ct = default);
}

// ITicketRepository.cs
public interface ITicketRepository
{
    Task<Ticket?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<IReadOnlyList<Ticket>> GetAllAsync(CancellationToken ct = default);
    Task<IReadOnlyList<Ticket>> GetByAuthorAsync(Guid authorId, CancellationToken ct = default);
    Task AddAsync(Ticket ticket, CancellationToken ct = default);
    Task UpdateAsync(Ticket ticket, CancellationToken ct = default);
    Task AddCommentAsync(TicketComment comment, CancellationToken ct = default);
}

// IDiscordNotifier.cs
public interface IDiscordNotifier
{
    Task NotifyNewTicketAsync(Ticket ticket, CancellationToken ct = default);
    Task NotifyTicketDecisionAsync(Ticket ticket, CancellationToken ct = default);
}

// IPlayerDataAggregator.cs
public interface IPlayerDataAggregator
{
    Task<PlayerDataResult> GetPlayerDataAsync(string gameNickname, CancellationToken ct = default);
}

// ICurrentUserService.cs — читает JWT claims из HttpContext
public interface ICurrentUserService
{
    Guid UserId { get; }
    UserRank Rank { get; }
    bool IsAuthenticated { get; }
}
```

---

## Awake.Infrastructure

Конкретные реализации интерфейсов: EF Core, HTTP-клиенты, Discord.

### Структура папок

```
Awake.Infrastructure/
├── Persistence/
│   ├── AppDbContext.cs
│   ├── Configurations/          ← IEntityTypeConfiguration<T> для каждой сущности
│   │   ├── UserConfiguration.cs
│   │   ├── SquadConfiguration.cs
│   │   ├── SquadMemberConfiguration.cs
│   │   ├── TicketConfiguration.cs
│   │   └── TicketCommentConfiguration.cs
│   ├── Repositories/
│   │   ├── UserRepository.cs
│   │   ├── SquadRepository.cs
│   │   └── TicketRepository.cs
│   └── Migrations/
├── ExternalServices/
│   ├── Discord/
│   │   ├── DiscordNotifier.cs
│   │   └── DiscordWebhookPayload.cs
│   └── PlayerData/
│       ├── PlayerDataAggregator.cs  ← дёргает несколько сайтов параллельно
│       └── Sources/                 ← по одному классу на каждый внешний сайт
│           ├── IPlayerDataSource.cs
│           ├── SiteOneDataSource.cs
│           └── SiteTwoDataSource.cs
├── Identity/
│   └── CurrentUserService.cs    ← читает HttpContext.User claims
└── DependencyInjection.cs       ← регистрация всего Infrastructure
```

### AppDbContext

```csharp
public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Squad> Squads => Set<Squad>();
    public DbSet<SquadMember> SquadMembers => Set<SquadMember>();
    public DbSet<Ticket> Tickets => Set<Ticket>();
    public DbSet<TicketComment> TicketComments => Set<TicketComment>();

    protected override void OnModelCreating(ModelBuilder builder)
        => builder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);

    // Автообновление UpdatedAt при SaveChanges
    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        foreach (var entry in ChangeTracker.Entries<BaseEntity>()
            .Where(e => e.State == EntityState.Modified))
            entry.Entity.UpdatedAt = DateTime.UtcNow;

        return base.SaveChangesAsync(ct);
    }
}
```

### Пример конфигурации EF (паттерн для всех)

```csharp
// SquadMemberConfiguration.cs
public class SquadMemberConfiguration : IEntityTypeConfiguration<SquadMember>
{
    public void Configure(EntityTypeBuilder<SquadMember> builder)
    {
        builder.HasKey(x => x.Id);

        builder.HasOne(x => x.Squad)
            .WithMany(x => x.Members)
            .HasForeignKey(x => x.SquadId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(x => x.User)
            .WithMany(x => x.SquadMemberships)
            .HasForeignKey(x => x.UserId)
            .OnDelete(DeleteBehavior.Restrict);

        // Бизнес-правило: только один лидер на отряд — через фильтрованный индекс
        builder.HasIndex(x => new { x.SquadId, x.IsLeader })
            .HasFilter("\"IsLeader\" = true")
            .IsUnique();

        // Бизнес-правило: один пользователь — один отряд
        builder.HasIndex(x => x.UserId).IsUnique();
    }
}
```

### PlayerDataAggregator — параллельный запрос к внешним сайтам

```csharp
public class PlayerDataAggregator(IEnumerable<IPlayerDataSource> sources) : IPlayerDataAggregator
{
    public async Task<PlayerDataResult> GetPlayerDataAsync(string nickname, CancellationToken ct)
    {
        // Запрашиваем все источники параллельно, не падаем если один недоступен
        var tasks = sources.Select(s => s.TryGetDataAsync(nickname, ct));
        var results = await Task.WhenAll(tasks);
        return new PlayerDataResult(nickname, results.Where(r => r is not null).ToList());
    }
}
```

---

## Awake.API

Точка входа. Контроллеры, Middleware, конфигурация DI, JWT.

### Структура папок

```
Awake.API/
├── Controllers/
│   ├── AuthController.cs
│   ├── SquadsController.cs
│   ├── TicketsController.cs
│   ├── UsersController.cs
│   └── StatsController.cs
├── Middleware/
│   └── GlobalExceptionMiddleware.cs
├── Extensions/
│   └── ServiceCollectionExtensions.cs  ← JWT, CORS, Rate Limiting
├── Filters/
│   └── RankAuthorizeAttribute.cs       ← [RankAuthorize(UserRank.Officer)]
├── appsettings.json
├── appsettings.Development.json
└── Program.cs
```

### Program.cs — порядок регистрации

```csharp
var builder = WebApplication.CreateBuilder(args);

// 1. Проекты
builder.Services.AddApplication();       // из Awake.Application
builder.Services.AddInfrastructure(builder.Configuration);  // из Awake.Infrastructure

// 2. API
builder.Services.AddControllers();
builder.Services.AddJwtAuthentication(builder.Configuration);
builder.Services.AddRateLimiting();
builder.Services.AddCorsPolicies(builder.Configuration);

// 3. Serilog
builder.Host.UseSerilog((ctx, cfg) => cfg.ReadFrom.Configuration(ctx.Configuration));

var app = builder.Build();

// 4. Middleware pipeline (порядок важен)
app.UseMiddleware<GlobalExceptionMiddleware>();  // первым — ловит всё
app.UseSerilogRequestLogging();
app.UseHttpsRedirection();
app.UseCors("AllowFrontend");
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.MapControllers();

app.Run();
```

### Контроллер — паттерн

```csharp
[ApiController]
[Route("api/[controller]")]
public class TicketsController(ISender sender) : ControllerBase
{
    [HttpPost]
    [Authorize]                              // любой авторизованный
    public async Task<IActionResult> Create(CreateTicketRequest request, CancellationToken ct)
    {
        var command = new CreateTicketCommand(
            AuthorId: User.GetUserId(),      // extension метод для claims
            GameNickname: request.GameNickname,
            Type: request.Type,
            Description: request.Description
        );

        var result = await sender.Send(command, ct);

        return result.IsSuccess
            ? CreatedAtAction(nameof(GetById), new { id = result.Value!.Id }, result.Value)
            : BadRequest(result.Error);
    }

    [HttpPut("{id}/status")]
    [RankAuthorize(UserRank.Officer)]        // только Officer и выше
    public async Task<IActionResult> UpdateStatus(Guid id, UpdateTicketStatusRequest request, CancellationToken ct)
    {
        var command = new UpdateTicketStatusCommand(id, request.Status, User.GetUserId());
        var result = await sender.Send(command, ct);
        return result.IsSuccess ? Ok() : BadRequest(result.Error);
    }
}
```

### GlobalExceptionMiddleware

```csharp
// Перехватывает все необработанные исключения, возвращает стандартный ProblemDetails.
// Domain Exceptions → 400/403/404
// Остальное → 500 (детали скрыты от клиента, но логируются полностью)

catch (NotFoundException ex)     → 404 ProblemDetails
catch (ForbiddenException ex)    → 403 ProblemDetails
catch (DomainException ex)       → 400 ProblemDetails
catch (ValidationException ex)   → 400 с деталями по полям
catch (Exception ex)             → 500, логируем стектрейс, клиенту "Внутренняя ошибка"
```

### RankAuthorizeAttribute

```csharp
// [RankAuthorize(UserRank.Colonel)] — пропускает Colonel и Leader
// Читает rank claim из JWT, сравнивает как int (Guest=0 < Member=1 < ... < Leader=4)
public class RankAuthorizeAttribute(UserRank minimumRank) : AuthorizeAttribute, IAuthorizationFilter
{
    public void OnAuthorization(AuthorizationFilterContext context)
    {
        var userRank = context.HttpContext.User.GetRank();
        if (userRank < minimumRank)
            context.Result = new ForbidResult();
    }
}
```

Атрибут отвечает только на вопрос «пускать ли в эндпоинт». Кого именно можно
там тронуть — решает обработчик: смена ранга (`UpdateUserRankCommandHandler`)
подчиняется строгой лестнице.

- менять можно только тех, кто **ниже** тебя рангом (равного — нельзя, это же
  закрывает и собственную строку);
- выдавать можно только ранг **ниже своего** — ступень под собой.

| ранг | правит | поднимает до |
|---|---|---|
| Officer | Guest, Member | Member |
| Colonel | Guest … Officer | Officer |
| Leader | Guest … Colonel | Colonel |

Поэтому полковник не разжалует лидера, а офицер — полковника. Ранг Leader через
API не выдаётся вовсе: его ставят в базе. Так же устроен и автосинк ролей
Discord — он ограничен потолком Colonel и лидера не трогает.

### JWT Payload

```json
{
  "sub": "user-guid",
  "username": "StalkerZero",
  "rank": "2",               // UserRank как int
  "jti": "token-guid",       // для инвалидации
  "exp": 1234567890
}
```

---

## Frontend (React + Vite + TanStack)

**Стек:** React 19 · Vite · TypeScript · TanStack Router · TanStack Query · Tailwind CSS · shadcn/ui · i18next

### Почему этот стек

- Весь сайт за авторизацией → SSR не нужен, SPA достаточно
- TanStack Router — type-safe роуты, автокомплит путей, встроенные guards
- TanStack Query — кэш, loading/error стейты, фоновые refetch из коробки
- Деплой на Railway как статика (Vite build → nginx или Railway static)

### Структура папок

```
awake-web/
├── src/
│   ├── routes/                ← TanStack Router файловый роутинг
│   │   ├── __root.tsx         ← root layout (тема, i18n, QueryClientProvider)
│   │   ├── index.tsx          ← лендинг /
│   │   ├── login.tsx          ← /login
│   │   ├── register.tsx       ← /register
│   │   ├── _auth.tsx          ← layout-guard: редирект если не авторизован
│   │   ├── _auth.dashboard.tsx
│   │   ├── _auth.squads.tsx
│   │   ├── _auth.squads.$id.tsx
│   │   ├── _auth.tickets.tsx
│   │   ├── _auth.tickets.new.tsx
│   │   ├── _auth.tickets.$id.tsx
│   │   ├── _auth.stats.tsx
│   │   ├── _auth.stats.$username.tsx
│   │   ├── _auth.manage.users.tsx    ← colonel+
│   │   ├── _auth.manage.squads.tsx   ← colonel+
│   │   └── _auth.settings.tsx
│   ├── components/
│   │   ├── ui/                ← shadcn/ui (авто-генерируются cli)
│   │   ├── layout/
│   │   │   ├── Navbar.tsx
│   │   │   └── RankGuard.tsx  ← <RankGuard min={UserRank.Officer}>
│   │   ├── tickets/
│   │   │   ├── TicketCard.tsx
│   │   │   ├── TicketForm.tsx
│   │   │   └── PlayerDataCard.tsx
│   │   ├── squads/
│   │   │   ├── SquadCard.tsx
│   │   │   └── SquadMemberRow.tsx
│   │   └── stats/
│   │       └── PlayerStatsCard.tsx
│   ├── api/                   ← типизированные функции запросов (используются в useQuery)
│   │   ├── client.ts          ← базовый fetch с JWT, refresh логика
│   │   ├── tickets.ts         ← getTickets(), createTicket(), updateStatus()
│   │   ├── squads.ts
│   │   ├── users.ts
│   │   └── stats.ts
│   ├── store/
│   │   └── authStore.ts       ← Zustand: текущий пользователь, токены, rank
│   ├── hooks/
│   │   ├── useAuth.ts         ← обёртка над authStore
│   │   └── useTheme.ts        ← dark/light, localStorage
│   ├── types/
│   │   └── api.ts             ← TypeScript типы = зеркало C# DTO
│   ├── i18n/
│   │   ├── index.ts           ← i18next init
│   │   ├── ru.json
│   │   └── en.json
│   └── main.tsx
├── tailwind.config.ts
└── vite.config.ts
```

### Просмотрщик мира (вкладка «Мир»)

Небо — кубическая карта из самой игры, выгруженная `tools/maps/export_sky.py` в
`public/sky`. Ставится фоном сцены, освещения не даёт. Туман под цвет горизонта
прячет стык карты с нарисованной на скайбоксе землёй; границы заданы долями
размаха локации. Обзорной камеры нет: локация открывается сразу от первого
лица, а панель расстановок и выход живут в меню по Esc.

### TanStack Router — паттерн защищённого роута

```tsx
// routes/_auth.tsx — layout-guard для всех приватных страниц
export const Route = createFileRoute('/_auth')({
  beforeLoad: ({ context }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: '/login' })
    }
  },
  component: AuthLayout,  // Navbar + Sidebar + <Outlet />
})

// Защита по рангу прямо в роуте
// routes/_auth.manage.users.tsx
export const Route = createFileRoute('/_auth/manage/users')({
  beforeLoad: ({ context }) => {
    if (context.auth.rank < UserRank.Colonel) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: ManageUsersPage,
})
```

### TanStack Query — паттерн

```tsx
// api/tickets.ts
export const ticketsApi = {
  getAll: () =>
    apiClient.get<Ticket[]>('/tickets'),

  getById: (id: string) =>
    apiClient.get<TicketDetail>(`/tickets/${id}`),

  create: (data: CreateTicketRequest) =>
    apiClient.post<CreateTicketResponse>('/tickets', data),

  updateStatus: (id: string, status: TicketStatus) =>
    apiClient.put(`/tickets/${id}/status`, { status }),
}

// В компоненте
const { data: tickets, isLoading } = useQuery({
  queryKey: ['tickets'],
  queryFn: ticketsApi.getAll,
})

const { mutate: updateStatus } = useMutation({
  mutationFn: ({ id, status }) => ticketsApi.updateStatus(id, status),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tickets'] }),
})
```

### Auth Store (Zustand)

```ts
// store/authStore.ts
interface AuthState {
  user: CurrentUser | null
  accessToken: string | null
  isAuthenticated: boolean
  rank: UserRank
  login: (user: CurrentUser, token: string) => void
  logout: () => void
}

// accessToken — в памяти (не в localStorage — XSS защита)
// refreshToken — в httpOnly cookie (устанавливает бэкенд)
```

### Tailwind — цветовые токены

```ts
// tailwind.config.ts
theme: {
  extend: {
    colors: {
      bg: {
        page:  '#0e0e0f',
        card:  '#161618',
        hover: '#1f1f22',
      },
      border: '#2a2a2e',
      text: {
        primary: '#f0ede8',
        muted:   '#6b6b72',
      },
      accent: {
        DEFAULT: '#3ddc84',
        hover:   '#2fc274',
        tint:    'rgba(61,220,132,0.12)',
      },
    },
  },
}
// Использование: bg-bg-card, text-accent, border-border, text-text-muted
```

### API клиент — паттерн

```ts
// lib/api/client.ts
async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getAccessToken();  // из localStorage / cookie
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json();
    throw new ApiError(res.status, error.detail ?? 'Ошибка запроса');
  }
  return res.json();
}
```

---

## DI-регистрация — где что регистрируется

### Awake.Application/DependencyInjection.cs

```csharp
services.AddMediatR(cfg => cfg.RegisterServicesFromAssembly(Assembly.GetExecutingAssembly()));
services.AddValidatorsFromAssembly(Assembly.GetExecutingAssembly());
services.AddTransient(typeof(IPipelineBehavior<,>), typeof(ValidationBehavior<,>));
services.AddTransient(typeof(IPipelineBehavior<,>), typeof(LoggingBehavior<,>));
```

### Awake.Infrastructure/DependencyInjection.cs

```csharp
// БД
services.AddDbContext<AppDbContext>(opt =>
    opt.UseNpgsql(configuration.GetConnectionString("Postgres")));

// Репозитории — Scoped (один на запрос)
services.AddScoped<IUserRepository, UserRepository>();
services.AddScoped<ISquadRepository, SquadRepository>();
services.AddScoped<ITicketRepository, TicketRepository>();

// Внешние сервисы
services.AddHttpClient<IDiscordNotifier, DiscordNotifier>();
services.AddHttpClient<SiteOneDataSource>();
services.AddHttpClient<SiteTwoDataSource>();
services.AddScoped<IPlayerDataAggregator, PlayerDataAggregator>();

// Identity
services.AddScoped<ICurrentUserService, CurrentUserService>();

// Источники данных игрока — регистрируем все IPlayerDataSource
services.AddScoped<IPlayerDataSource, SiteOneDataSource>();
services.AddScoped<IPlayerDataSource, SiteTwoDataSource>();
```

---

## Переменные окружения

```
# Awake.API (Railway Variables)
ConnectionStrings__Postgres=Host=...;Database=awake;Username=...;Password=...
Jwt__Secret=<256-bit секрет>
Jwt__Issuer=api.stalcraftclans.cc
Jwt__Audience=stalcraftclans.cc
Discord__WebhookUrl=https://discord.com/api/webhooks/...
Cors__AllowedOrigin=https://stalcraftclans.cc

# awake-web (Railway Variables)
NEXT_PUBLIC_API_URL=https://api.stalcraftclans.cc
```

**Правило:** секреты никогда в коде и в git. Только через Railway Variables / переменные окружения.

---

## Правила именования

| Что | Стиль | Пример |
|---|---|---|
| Классы, Record | PascalCase | `CreateTicketCommand` |
| Интерфейсы | IPascalCase | `ITicketRepository` |
| Методы | PascalCase | `GetByIdAsync` |
| Приватные поля | _camelCase | `_repository` |
| Параметры конструктора | camelCase | `ticketRepository` |
| Константы | PascalCase | `JwtClaims.Rank` |
| TS компоненты | PascalCase | `TicketCard.tsx` |
| TS хуки | camelCase + use | `useAuth` |
| TS утилиты | camelCase | `apiFetch` |
| CSS классы | kebab-case (Tailwind) | `bg-bg-card` |

---

## Чеклист перед каждым PR

- [ ] Новая фича — новый Command/Query + Handler, не правим существующие Handler'ы
- [ ] Все зависимости через конструктор, нет `new` в бизнес-логике
- [ ] Есть Validator для каждой Command с данными от пользователя
- [ ] Репозиторий принимает `CancellationToken`
- [ ] Секреты не в коде
- [ ] Endpoint закрыт `[Authorize]` или `[RankAuthorize]` если нужно
- [ ] Ошибки возвращаются через `Result<T>` или Domain Exception (не голый throw)

using System.Security.Claims;
using Awake.API.Services;
using Awake.Application.Common.Interfaces;
using Awake.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Awake.API.Hubs;

/// <summary>Игрок на карте в том виде, в каком его получает клиент.</summary>
public sealed record WorldPlayerDto(
    string Id,
    string Username,
    double X,
    double Y,
    double Z,
    double Yaw,
    double Speed,
    bool Flying);

/// <summary>
/// Всё, что нужно знать вошедшему: кто уже здесь и что здесь расставлено.
/// </summary>
public sealed record WorldSnapshotDto(
    IReadOnlyList<WorldPlayerDto> Players,
    IReadOnlyList<WorldProp> Props);

/// <summary>
/// Совместное присутствие на карте.
///
/// Сервер только раздаёт координаты: сцена, столкновения и движение целиком
/// на клиенте, авторитетной симуляции здесь нет. Для просмотра локаций кланом
/// этого достаточно, а полноценный серверный контроль движения стоил бы
/// несоизмеримо дороже.
/// </summary>
[Authorize]
public sealed class WorldHub(IWorldPresence presence, IMapAssetService maps) : Hub
{
    /// <summary>Мир доступен с того же ранга, что и карты в REST-контроллере.</summary>
    private const UserRank MinimumRank = UserRank.Member;

    public override async Task OnConnectedAsync()
    {
        // RankAuthorizeAttribute — это фильтр MVC, на хабы он не действует,
        // поэтому ранг проверяем здесь и рвём соединение сразу.
        if (Rank() < MinimumRank)
        {
            Context.Abort();
            return;
        }

        await base.OnConnectedAsync();
    }

    /// <summary>
    /// Войти на локацию.
    ///
    /// Возвращает и тех, кто уже там, и общую расстановку — чтобы вошедший
    /// увидел мир целиком сразу, а не дожидался, пока кто-то шевельнётся или
    /// переставит заграждение.
    ///
    /// Свою расстановку игрок приносит с собой: если он первый на локации, она
    /// и становится общей, иначе он принимает уже сложившуюся. Затравка идёт
    /// внутри Join, а не отдельным вызовом, — так двое, вошедшие одновременно,
    /// не затрут работу друг друга.
    /// </summary>
    public async Task<WorldSnapshotDto> Join(string location, IReadOnlyList<WorldProp>? props)
    {
        if (Rank() < MinimumRank)
            throw new HubException("Недостаточно прав");

        if (string.IsNullOrWhiteSpace(location) || !maps.IsKnownLocation(location))
            throw new HubException("Неизвестная локация");

        // повторный вход — сначала уходим с прежней карты
        await RemoveAsync();

        var player = presence.Join(
            Context.ConnectionId,
            Context.UserIdentifier ?? "?",
            Context.User?.FindFirst("username")?.Value ?? "?",
            location);

        await Groups.AddToGroupAsync(Context.ConnectionId, location);
        await Clients.OthersInGroup(location).SendAsync("PlayerJoined", ToDto(player));

        var shared = presence.SeedProps(location, Sanitize(props));

        return new WorldSnapshotDto(
            presence.InLocation(location, Context.ConnectionId).Select(ToDto).ToList(),
            shared);
    }

    /// <summary>Поставить заграждение — оно появляется у всех на локации.</summary>
    public async Task PlaceProp(WorldProp prop)
    {
        var player = presence.Find(Context.ConnectionId);
        if (player is null || !IsValid(prop))
            return;

        if (presence.AddProp(player.Location, prop))
            await Clients.OthersInGroup(player.Location).SendAsync("PropPlaced", prop);
    }

    /// <summary>Убрать заграждение.</summary>
    public async Task RemoveProp(string id)
    {
        var player = presence.Find(Context.ConnectionId);
        if (player is null || string.IsNullOrWhiteSpace(id))
            return;

        if (presence.RemoveProp(player.Location, id))
            await Clients.OthersInGroup(player.Location).SendAsync("PropRemoved", id);
    }

    /// <summary>
    /// Отправить своё положение. Клиент шлёт это несколько раз в секунду, так
    /// что метод обязан быть дешёвым: ни базы, ни поиска по спискам.
    /// </summary>
    public async Task Move(double x, double y, double z, double yaw, double speed, bool flying)
    {
        var player = presence.Find(Context.ConnectionId);
        if (player is null)
            return;

        // NaN и бесконечность разъезжаются по всем клиентам и ломают им сцену
        if (!IsFinite(x) || !IsFinite(y) || !IsFinite(z) || !IsFinite(yaw) || !IsFinite(speed))
            return;

        player.X = x;
        player.Y = y;
        player.Z = z;
        player.Yaw = yaw;
        player.Speed = speed;
        player.Flying = flying;

        await Clients.OthersInGroup(player.Location).SendAsync("PlayerMoved", ToDto(player));
    }

    /// <summary>Выйти с карты, оставшись подключённым.</summary>
    public Task Leave() => RemoveAsync();

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await RemoveAsync();
        await base.OnDisconnectedAsync(exception);
    }

    private async Task RemoveAsync()
    {
        var gone = presence.Leave(Context.ConnectionId);
        if (gone is null)
            return;

        await Groups.RemoveFromGroupAsync(Context.ConnectionId, gone.Location);
        await Clients.Group(gone.Location).SendAsync("PlayerLeft", gone.ConnectionId);

        // Ушёл последний — общую расстановку забываем: это состояние сеанса, а
        // не хранилище. Постоянные расстановки лежат в базе под именами.
        if (presence.InLocation(gone.Location).Count == 0)
            presence.DropLocation(gone.Location);
    }

    /// <summary>
    /// Отсекает мусор во входящей расстановке. Данные приходят от клиента, а
    /// расходятся по всем — сломанное число или строка на мегабайт разъедутся
    /// сразу всем и уронят им сцену.
    /// </summary>
    private static IReadOnlyList<WorldProp> Sanitize(IReadOnlyList<WorldProp>? props) =>
        props is null ? [] : props.Where(IsValid).Take(WorldPresence.MaxProps).ToList();

    private const int MaxIdLength = 64;

    private static bool IsValid(WorldProp prop) =>
        !string.IsNullOrWhiteSpace(prop.Id) &&
        prop.Id.Length <= MaxIdLength &&
        !string.IsNullOrWhiteSpace(prop.Kind) &&
        prop.Kind.Length <= MaxIdLength &&
        IsFinite(prop.X) && IsFinite(prop.Y) && IsFinite(prop.Z) && IsFinite(prop.Rotation);

    private UserRank Rank()
    {
        var claim = Context.User?.FindFirst("rank")?.Value;
        return int.TryParse(claim, out var value) ? (UserRank)value : default;
    }

    private static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);

    private static WorldPlayerDto ToDto(WorldPlayer p) =>
        new(p.ConnectionId, p.Username, p.X, p.Y, p.Z, p.Yaw, p.Speed, p.Flying);
}

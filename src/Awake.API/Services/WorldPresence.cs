using System.Collections.Concurrent;

namespace Awake.API.Services;

/// <summary>
/// Игрок, находящийся сейчас на карте.
/// </summary>
public sealed class WorldPlayer
{
    /// <summary>
    /// Идентификатор соединения, а не пользователя: одна учётка может открыть
    /// две вкладки, и это должны быть две разные фигуры на карте.
    /// </summary>
    public required string ConnectionId { get; init; }

    public required string UserId { get; init; }
    public required string Username { get; init; }
    public required string Location { get; init; }

    public double X { get; set; }
    public double Y { get; set; }
    public double Z { get; set; }

    /// <summary>Разворот фигуры вокруг вертикали, в радианах.</summary>
    public double Yaw { get; set; }

    /// <summary>Горизонтальная скорость в блоках в секунду — по ней подбирается анимация.</summary>
    public double Speed { get; set; }

    public bool Flying { get; set; }
}

/// <summary>Заграждение, поставленное на карте.</summary>
public sealed record WorldProp(
    string Id,
    string Kind,
    double X,
    double Y,
    double Z,
    double Rotation);

/// <summary>
/// Кто сейчас на каких картах и что на них расставлено.
/// </summary>
public interface IWorldPresence
{
    WorldPlayer Join(string connectionId, string userId, string username, string location);

    /// <summary>Убирает игрока и возвращает то, чем он был, либо null.</summary>
    WorldPlayer? Leave(string connectionId);

    WorldPlayer? Find(string connectionId);

    /// <summary>Все на локации, кроме указанного соединения.</summary>
    IReadOnlyList<WorldPlayer> InLocation(string location, string? exceptConnectionId = null);

    /// <summary>
    /// Заводит общую расстановку локации, если её ещё нет, и возвращает
    /// действующую. Тот, кто пришёл первым, задаёт её своей; остальные получают
    /// уже готовую. Проверка и запись идут одним действием, поэтому двое,
    /// вошедшие одновременно, не затрут работу друг друга.
    /// </summary>
    IReadOnlyList<WorldProp> SeedProps(string location, IReadOnlyList<WorldProp> props);

    IReadOnlyList<WorldProp> GetProps(string location);

    /// <summary>Ставит заграждение. false — если такое уже есть или упёрлись в предел.</summary>
    bool AddProp(string location, WorldProp prop);

    bool RemoveProp(string location, string id);

    /// <summary>Забывает расстановку локации: звать, когда ушёл последний игрок.</summary>
    void DropLocation(string location);
}

/// <summary>
/// Присутствие в памяти процесса.
///
/// Хранить его в базе незачем: список живёт ровно столько, сколько держатся
/// соединения, и при перезапуске всё равно должен обнулиться. Оговорка одна —
/// при нескольких экземплярах приложения игроки на разных экземплярах друг
/// друга не увидят; для этого SignalR понадобился бы общий backplane.
/// </summary>
public sealed class WorldPresence : IWorldPresence
{
    /// <summary>
    /// Столько же, сколько принимает сохранение расстановки в базу: держать в
    /// памяти больше, чем можно сохранить, смысла нет.
    /// </summary>
    public const int MaxProps = 2000;

    private readonly ConcurrentDictionary<string, WorldPlayer> players = new();

    /// <summary>
    /// Живая расстановка по локациям. Список правят несколько соединений сразу,
    /// поэтому каждый под своим замком.
    /// </summary>
    private readonly ConcurrentDictionary<string, LocationProps> props = new();

    private sealed class LocationProps
    {
        public readonly Lock Gate = new();
        public readonly List<WorldProp> Items = [];
        public bool Initialized;
    }

    public WorldPlayer Join(string connectionId, string userId, string username, string location)
    {
        var player = new WorldPlayer
        {
            ConnectionId = connectionId,
            UserId = userId,
            Username = username,
            Location = location,
        };
        players[connectionId] = player;
        return player;
    }

    public WorldPlayer? Leave(string connectionId) =>
        players.TryRemove(connectionId, out var player) ? player : null;

    public WorldPlayer? Find(string connectionId) =>
        players.TryGetValue(connectionId, out var player) ? player : null;

    public IReadOnlyList<WorldPlayer> InLocation(string location, string? exceptConnectionId = null) =>
        players.Values
            .Where(p => p.Location == location && p.ConnectionId != exceptConnectionId)
            .ToList();

    public IReadOnlyList<WorldProp> SeedProps(string location, IReadOnlyList<WorldProp> incoming)
    {
        var state = props.GetOrAdd(location, _ => new LocationProps());
        lock (state.Gate)
        {
            if (!state.Initialized)
            {
                state.Initialized = true;
                state.Items.AddRange(incoming.Take(MaxProps));
            }

            return state.Items.ToList();
        }
    }

    public IReadOnlyList<WorldProp> GetProps(string location)
    {
        if (!props.TryGetValue(location, out var state))
            return [];

        lock (state.Gate)
            return state.Items.ToList();
    }

    public bool AddProp(string location, WorldProp prop)
    {
        var state = props.GetOrAdd(location, _ => new LocationProps());
        lock (state.Gate)
        {
            if (state.Items.Count >= MaxProps)
                return false;
            if (state.Items.Any(p => p.Id == prop.Id))
                return false;

            state.Items.Add(prop);
            return true;
        }
    }

    public bool RemoveProp(string location, string id)
    {
        if (!props.TryGetValue(location, out var state))
            return false;

        lock (state.Gate)
            return state.Items.RemoveAll(p => p.Id == id) > 0;
    }

    public void DropLocation(string location) => props.TryRemove(location, out _);
}

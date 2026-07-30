using System.Security.Claims;
using Awake.API.Hubs;
using Awake.API.Services;
using Awake.Application.Common.Interfaces;
using Awake.Domain.Enums;
using FluentAssertions;
using Microsoft.AspNetCore.SignalR;
using Moq;

namespace Awake.Integration.Tests.Hubs;

/// <summary>
/// Проверяет допуск в общий мир и раздачу присутствия.
///
/// Ранг здесь особенно важен: RankAuthorizeAttribute — это фильтр MVC, на хабы
/// он не действует вовсе, и если проверку в хабе сломать, карты станут доступны
/// любому, у кого есть учётка.
/// </summary>
public class WorldHubTests
{
    private const string Location = "nizina";

    private readonly Mock<IMapAssetService> _assets = new();
    private readonly WorldPresence _presence = new();

    private readonly Mock<IHubCallerClients> _clients = new();
    private readonly Mock<IClientProxy> _others = new();
    private readonly Mock<IClientProxy> _group = new();
    private readonly Mock<IGroupManager> _groups = new();

    public WorldHubTests()
    {
        _assets.Setup(x => x.IsKnownLocation(It.IsAny<string>())).Returns(true);
        _clients.Setup(x => x.OthersInGroup(It.IsAny<string>())).Returns(_others.Object);
        _clients.Setup(x => x.Group(It.IsAny<string>())).Returns(_group.Object);
    }

    private WorldHub BuildHub(
        string connectionId = "c1",
        UserRank rank = UserRank.Member,
        string username = "Боец",
        string? userId = null)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, userId ?? Guid.NewGuid().ToString()),
            new("username", username),
            new("rank", ((int)rank).ToString()),
        };

        var context = new Mock<HubCallerContext>();
        context.SetupGet(x => x.ConnectionId).Returns(connectionId);
        context.SetupGet(x => x.UserIdentifier).Returns(userId ?? Guid.NewGuid().ToString());
        context.SetupGet(x => x.User).Returns(new ClaimsPrincipal(new ClaimsIdentity(claims, "test")));

        return new WorldHub(_presence, _assets.Object)
        {
            Context = context.Object,
            Clients = _clients.Object,
            Groups = _groups.Object,
        };
    }

    [Fact]
    public async Task Join_KnownLocation_AddsToGroup()
    {
        var hub = BuildHub();

        var snapshot = await hub.Join(Location, []);

        snapshot.Players.Should().BeEmpty();
        _groups.Verify(x => x.AddToGroupAsync("c1", Location, It.IsAny<CancellationToken>()), Times.Once);
        _presence.InLocation(Location).Should().ContainSingle();
    }

    [Fact]
    public async Task Join_UnknownLocation_Throws()
    {
        _assets.Setup(x => x.IsKnownLocation("выдумка")).Returns(false);
        var hub = BuildHub();

        var act = () => hub.Join("выдумка", []);

        await act.Should().ThrowAsync<HubException>();
        _presence.InLocation("выдумка").Should().BeEmpty();
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Join_EmptyLocation_Throws(string location)
    {
        var hub = BuildHub();

        var act = () => hub.Join(location, []);

        await act.Should().ThrowAsync<HubException>();
    }

    [Fact]
    public async Task Join_BelowMemberRank_Throws()
    {
        var hub = BuildHub(rank: UserRank.Guest);

        var act = () => hub.Join(Location, []);

        await act.Should().ThrowAsync<HubException>();
        _presence.InLocation(Location).Should().BeEmpty();
    }

    [Fact]
    public async Task OnConnected_BelowMemberRank_AbortsConnection()
    {
        var context = new Mock<HubCallerContext>();
        context.SetupGet(x => x.ConnectionId).Returns("c1");
        context.SetupGet(x => x.User).Returns(new ClaimsPrincipal(
            new ClaimsIdentity([new Claim("rank", ((int)UserRank.Guest).ToString())], "test")));

        var hub = new WorldHub(_presence, _assets.Object)
        {
            Context = context.Object,
            Clients = _clients.Object,
            Groups = _groups.Object,
        };

        await hub.OnConnectedAsync();

        context.Verify(x => x.Abort(), Times.Once);
    }

    [Fact]
    public async Task Join_SecondPlayer_SeesTheFirst()
    {
        await BuildHub("c1", username: "Первый").Join(Location, []);

        var snapshot = await BuildHub("c2", username: "Второй").Join(Location, []);

        snapshot.Players.Should().ContainSingle().Which.Username.Should().Be("Первый");
    }

    private static WorldProp Prop(string id = "p1", string kind = "gabion") =>
        new(id, kind, 10, 20, 30, 0.5);

    [Fact]
    public async Task Join_FirstPlayer_HisLayoutBecomesShared()
    {
        var snapshot = await BuildHub().Join(Location, [Prop()]);

        snapshot.Props.Should().ContainSingle().Which.Id.Should().Be("p1");
    }

    [Fact]
    public async Task Join_SecondPlayer_GetsExistingLayoutNotHisOwn()
    {
        await BuildHub("c1").Join(Location, [Prop("первый")]);

        var snapshot = await BuildHub("c2").Join(Location, [Prop("второй")]);

        // вошедший принимает сложившуюся расстановку, а не навязывает свою
        snapshot.Props.Should().ContainSingle().Which.Id.Should().Be("первый");
    }

    [Fact]
    public async Task Join_BrokenPropsInLayout_Dropped()
    {
        var broken = new WorldProp("p2", "gabion", double.NaN, 0, 0, 0);

        var snapshot = await BuildHub().Join(Location, [Prop(), broken]);

        snapshot.Props.Should().ContainSingle().Which.Id.Should().Be("p1");
    }

    [Fact]
    public async Task PlaceProp_AddsAndNotifiesOthers()
    {
        var hub = BuildHub();
        await hub.Join(Location, []);

        await hub.PlaceProp(Prop());

        _presence.GetProps(Location).Should().ContainSingle();
        _others.Verify(
            x => x.SendCoreAsync("PropPlaced", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task PlaceProp_SameIdTwice_Ignored()
    {
        var hub = BuildHub();
        await hub.Join(Location, []);
        await hub.PlaceProp(Prop());

        await hub.PlaceProp(Prop());

        _presence.GetProps(Location).Should().ContainSingle();
        _others.Verify(
            x => x.SendCoreAsync("PropPlaced", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task PlaceProp_BrokenNumbers_Ignored()
    {
        var hub = BuildHub();
        await hub.Join(Location, []);

        await hub.PlaceProp(new WorldProp("p1", "gabion", double.NaN, 0, 0, 0));

        _presence.GetProps(Location).Should().BeEmpty();
    }

    [Fact]
    public async Task RemoveProp_RemovesAndNotifiesOthers()
    {
        var hub = BuildHub();
        await hub.Join(Location, [Prop()]);

        await hub.RemoveProp("p1");

        _presence.GetProps(Location).Should().BeEmpty();
        _others.Verify(
            x => x.SendCoreAsync("PropRemoved", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task PlaceProp_WithoutJoin_DoesNothing()
    {
        await BuildHub().PlaceProp(Prop());

        _presence.GetProps(Location).Should().BeEmpty();
    }

    [Fact]
    public async Task LastPlayerLeaves_LayoutForgotten()
    {
        var first = BuildHub("c1");
        var second = BuildHub("c2");
        await first.Join(Location, [Prop()]);
        await second.Join(Location, []);

        await first.Leave();
        _presence.GetProps(Location).Should().ContainSingle("пока кто-то остаётся, расстановка живёт");

        await second.Leave();
        _presence.GetProps(Location).Should().BeEmpty();
    }

    [Fact]
    public void SeedProps_ConcurrentJoins_KeepOneLayout()
    {
        // двое, вошедшие одновременно, не должны затирать работу друг друга
        var results = new IReadOnlyList<WorldProp>[2];

        Parallel.For(0, 2, i =>
        {
            results[i] = _presence.SeedProps(Location, [Prop($"игрок{i}")]);
        });

        results[0].Should().BeEquivalentTo(results[1]);
        _presence.GetProps(Location).Should().ContainSingle();
    }

    [Fact]
    public async Task Join_Twice_LeavesPreviousLocation()
    {
        var hub = BuildHub();
        await hub.Join(Location, []);

        await hub.Join("hvoiny", []);

        _presence.InLocation(Location).Should().BeEmpty();
        _presence.InLocation("hvoiny").Should().ContainSingle();
    }

    [Fact]
    public async Task Move_StoresPositionAndNotifiesOthers()
    {
        var hub = BuildHub();
        await hub.Join(Location, []);

        await hub.Move(10, 20, 30, 1.5, 6, false);

        var player = _presence.Find("c1")!;
        player.X.Should().Be(10);
        player.Y.Should().Be(20);
        player.Z.Should().Be(30);
        player.Yaw.Should().Be(1.5);
        player.Speed.Should().Be(6);
        _others.Verify(
            x => x.SendCoreAsync("PlayerMoved", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public async Task Move_BrokenNumbers_Ignored(double bad)
    {
        // такие значения разъезжаются по всем клиентам и ломают им сцену
        var hub = BuildHub();
        await hub.Join(Location, []);

        await hub.Move(bad, 0, 0, 0, 0, false);

        _presence.Find("c1")!.X.Should().Be(0);
        _others.Verify(
            x => x.SendCoreAsync("PlayerMoved", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task Move_WithoutJoin_DoesNothing()
    {
        var hub = BuildHub();

        await hub.Move(1, 2, 3, 0, 0, false);

        _others.Verify(
            x => x.SendCoreAsync(It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task Disconnect_RemovesPlayerAndNotifiesGroup()
    {
        var hub = BuildHub();
        await hub.Join(Location, []);

        await hub.OnDisconnectedAsync(null);

        _presence.InLocation(Location).Should().BeEmpty();
        _groups.Verify(x => x.RemoveFromGroupAsync("c1", Location, It.IsAny<CancellationToken>()), Times.Once);
        _group.Verify(
            x => x.SendCoreAsync("PlayerLeft", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task Leave_RemovesPlayer()
    {
        var hub = BuildHub();
        await hub.Join(Location, []);

        await hub.Leave();

        _presence.InLocation(Location).Should().BeEmpty();
    }
}

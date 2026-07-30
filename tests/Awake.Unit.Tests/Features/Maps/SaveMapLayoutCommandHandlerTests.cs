using Awake.Application.Common.Interfaces;
using Awake.Application.Common.Interfaces.Repositories;
using Awake.Application.Features.Maps.Commands.SaveMapLayout;
using Awake.Domain.Entities;
using Awake.Domain.Enums;
using FluentAssertions;
using Moq;

namespace Awake.Unit.Tests.Features.Maps;

public class SaveMapLayoutCommandHandlerTests
{
    private static readonly Guid Author = Guid.NewGuid();
    private static readonly Guid Stranger = Guid.NewGuid();

    private readonly Mock<IMapLayoutRepository> _layouts = new();
    private readonly Mock<IMapAssetService> _assets = new();
    private readonly Mock<ICurrentUserService> _currentUser = new();

    public SaveMapLayoutCommandHandlerTests()
    {
        _assets.Setup(x => x.IsKnownLocation(It.IsAny<string>())).Returns(true);
        _layouts.Setup(x => x.GetByLocationAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        _currentUser.SetupGet(x => x.UserId).Returns(Author);
        _currentUser.SetupGet(x => x.Rank).Returns(UserRank.Member);
    }

    private SaveMapLayoutCommandHandler BuildHandler()
        => new(_layouts.Object, _assets.Object, _currentUser.Object);

    private static SaveMapLayoutCommand Command(string name = "Оборона севера", string props = "[]")
        => new("nizina", name, props);

    [Fact]
    public async Task Handle_NewLayout_CreatesIt()
    {
        var result = await BuildHandler().Handle(Command(), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value!.Name.Should().Be("Оборона севера");
        result.Value.AuthorId.Should().Be(Author);
        _layouts.Verify(x => x.AddAsync(It.IsAny<MapLayout>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Handle_SameName_OverwritesInsteadOfDuplicating()
    {
        var existing = new MapLayout
        {
            Location = "nizina", Name = "Оборона севера", AuthorId = Author, Props = "[]",
        };
        _layouts.Setup(x => x.GetByLocationAsync("nizina", It.IsAny<CancellationToken>()))
            .ReturnsAsync([existing]);

        var result = await BuildHandler().Handle(
            Command(props: """[{"kind":"gabion"}]"""), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        existing.Props.Should().Be("""[{"kind":"gabion"}]""");
        _layouts.Verify(x => x.UpdateAsync(existing, It.IsAny<CancellationToken>()), Times.Once);
        _layouts.Verify(x => x.AddAsync(It.IsAny<MapLayout>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Handle_ForeignLayoutAsMember_IsRejected()
    {
        _layouts.Setup(x => x.GetByLocationAsync("nizina", It.IsAny<CancellationToken>()))
            .ReturnsAsync([new MapLayout { Location = "nizina", Name = "Оборона севера", AuthorId = Stranger }]);

        var result = await BuildHandler().Handle(Command(), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
        _layouts.Verify(x => x.UpdateAsync(It.IsAny<MapLayout>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Handle_ForeignLayoutAsColonel_IsAllowed()
    {
        _currentUser.SetupGet(x => x.Rank).Returns(UserRank.Colonel);
        _layouts.Setup(x => x.GetByLocationAsync("nizina", It.IsAny<CancellationToken>()))
            .ReturnsAsync([new MapLayout { Location = "nizina", Name = "Оборона севера", AuthorId = Stranger }]);

        var result = await BuildHandler().Handle(Command(), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        _layouts.Verify(x => x.UpdateAsync(It.IsAny<MapLayout>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Handle_UnknownLocation_IsRejected()
    {
        _assets.Setup(x => x.IsKnownLocation("mordor")).Returns(false);

        var result = await BuildHandler().Handle(
            new SaveMapLayoutCommand("mordor", "Что-то", "[]"), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
        _layouts.Verify(x => x.AddAsync(It.IsAny<MapLayout>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Handle_EmptyName_IsRejected(string name)
    {
        var result = await BuildHandler().Handle(Command(name), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
    }

    [Theory]
    [InlineData("не json")]
    [InlineData("{\"kind\":\"gabion\"}")] // объект вместо массива
    public async Task Handle_BrokenProps_IsRejected(string props)
    {
        var result = await BuildHandler().Handle(Command(props: props), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
        _layouts.Verify(x => x.AddAsync(It.IsAny<MapLayout>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Handle_TooManyProps_IsRejected()
    {
        var props = "[" + string.Join(",", Enumerable.Repeat("""{"kind":"gabion"}""", 2001)) + "]";

        var result = await BuildHandler().Handle(Command(props: props), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
    }
}

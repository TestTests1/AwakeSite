using Awake.Application.Common.Interfaces;
using Awake.Application.Features.Maps.Queries.GetMapModel;
using FluentAssertions;
using Moq;

namespace Awake.Unit.Tests.Features.Maps;

public class GetMapModelQueryHandlerTests
{
    private readonly Mock<IMapAssetService> _assets = new();

    private GetMapModelQueryHandler BuildHandler() => new(_assets.Object);

    [Fact]
    public async Task Handle_ModelExists_ReturnsSuccessWithPath()
    {
        _assets.Setup(s => s.GetModelPath("hvoiny")).Returns(@"C:\app\MapAssets\hvoiny.glb");

        var result = await BuildHandler().Handle(new GetMapModelQuery("hvoiny"), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().Be(@"C:\app\MapAssets\hvoiny.glb");
    }

    [Fact]
    public async Task Handle_ModelMissing_ReturnsFailure()
    {
        _assets.Setup(s => s.GetModelPath(It.IsAny<string>())).Returns((string?)null);

        var result = await BuildHandler().Handle(new GetMapModelQuery("hvoiny"), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task Handle_UnknownLocation_ReturnsFailure()
    {
        _assets.Setup(s => s.GetModelPath("pripyat")).Returns((string?)null);

        var result = await BuildHandler().Handle(new GetMapModelQuery("pripyat"), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
    }

    [Fact]
    public async Task Handle_PassesLocationThroughUnchanged()
    {
        _assets.Setup(s => s.GetModelPath(It.IsAny<string>())).Returns("path");

        await BuildHandler().Handle(new GetMapModelQuery("nizina"), CancellationToken.None);

        _assets.Verify(s => s.GetModelPath("nizina"), Times.Once);
    }
}

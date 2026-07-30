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
    public async Task Handle_LocalModel_ReturnsSuccessWithPath()
    {
        _assets.Setup(s => s.GetModelSource("hvoiny"))
            .Returns(new MapModelSource.LocalFile(@"C:\app\MapAssets\hvoiny.glb"));

        var result = await BuildHandler().Handle(new GetMapModelQuery("hvoiny"), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().BeOfType<MapModelSource.LocalFile>()
            .Which.Path.Should().Be(@"C:\app\MapAssets\hvoiny.glb");
    }

    [Fact]
    public async Task Handle_RemoteModel_ReturnsSuccessWithUrl()
    {
        _assets.Setup(s => s.GetModelSource("nizina"))
            .Returns(new MapModelSource.RemoteUrl("https://models.example.com/nizina.glb"));

        var result = await BuildHandler().Handle(new GetMapModelQuery("nizina"), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().BeOfType<MapModelSource.RemoteUrl>()
            .Which.Url.Should().Be("https://models.example.com/nizina.glb");
    }

    [Fact]
    public async Task Handle_ModelMissing_ReturnsFailure()
    {
        _assets.Setup(s => s.GetModelSource(It.IsAny<string>())).Returns((MapModelSource?)null);

        var result = await BuildHandler().Handle(new GetMapModelQuery("hvoiny"), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task Handle_UnknownLocation_ReturnsFailure()
    {
        _assets.Setup(s => s.GetModelSource("pripyat")).Returns((MapModelSource?)null);

        var result = await BuildHandler().Handle(new GetMapModelQuery("pripyat"), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
    }

    [Fact]
    public async Task Handle_PassesLocationThroughUnchanged()
    {
        _assets.Setup(s => s.GetModelSource(It.IsAny<string>()))
            .Returns(new MapModelSource.LocalFile("path"));

        await BuildHandler().Handle(new GetMapModelQuery("nizina"), CancellationToken.None);

        _assets.Verify(s => s.GetModelSource("nizina"), Times.Once);
    }
}

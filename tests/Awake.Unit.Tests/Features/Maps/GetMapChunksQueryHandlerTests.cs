using Awake.Application.Common.Interfaces;
using Awake.Application.Features.Maps.Queries.GetMapChunks;
using FluentAssertions;
using Moq;

namespace Awake.Unit.Tests.Features.Maps;

public class GetMapChunksQueryHandlerTests
{
    private readonly Mock<IMapAssetService> _assets = new();

    private GetMapChunksQueryHandler BuildHandler() => new(_assets.Object);

    [Fact]
    public async Task Handle_KnownLocation_ReturnsBaseUrl()
    {
        _assets.Setup(s => s.GetChunkBaseUrl("nizina"))
            .Returns("https://models.example.com/maps/v2/nizina");

        var result = await BuildHandler().Handle(new GetMapChunksQuery("nizina"), CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().Be("https://models.example.com/maps/v2/nizina");
    }

    [Fact]
    public async Task Handle_UnknownLocation_ReturnsFailure()
    {
        _assets.Setup(s => s.GetChunkBaseUrl(It.IsAny<string>())).Returns((string?)null);

        var result = await BuildHandler().Handle(new GetMapChunksQuery("pripyat"), CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
        result.Error.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task Handle_PassesLocationThroughUnchanged()
    {
        _assets.Setup(s => s.GetChunkBaseUrl(It.IsAny<string>())).Returns("url");

        await BuildHandler().Handle(new GetMapChunksQuery("small_berdovka"), CancellationToken.None);

        _assets.Verify(s => s.GetChunkBaseUrl("small_berdovka"), Times.Once);
    }
}

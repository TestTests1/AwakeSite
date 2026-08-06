using Awake.Application.Common.Interfaces;
using Awake.Application.Common.Models;
using MediatR;

namespace Awake.Application.Features.Maps.Queries.GetMapChunks;

public class GetMapChunksQueryHandler(IMapAssetService mapAssetService)
    : IRequestHandler<GetMapChunksQuery, Result<string>>
{
    public Task<Result<string>> Handle(GetMapChunksQuery request, CancellationToken cancellationToken)
    {
        var baseUrl = mapAssetService.GetChunkBaseUrl(request.Location);
        return Task.FromResult(baseUrl is not null
            ? Result<string>.Success(baseUrl)
            : Result<string>.Failure("Куски локации не найдены."));
    }
}

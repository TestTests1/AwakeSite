using Awake.Application.Common.Interfaces;
using Awake.Application.Common.Models;
using MediatR;

namespace Awake.Application.Features.Maps.Queries.GetMapModel;

public class GetMapModelQueryHandler(IMapAssetService mapAssetService)
    : IRequestHandler<GetMapModelQuery, Result<MapModelSource>>
{
    public Task<Result<MapModelSource>> Handle(GetMapModelQuery request, CancellationToken cancellationToken)
    {
        var source = mapAssetService.GetModelSource(request.Location);
        return Task.FromResult(source is not null
            ? Result<MapModelSource>.Success(source)
            : Result<MapModelSource>.Failure("Модель локации не найдена."));
    }
}
